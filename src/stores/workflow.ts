import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createProject, type AdaptationSetup, type EpisodeScript, type Project, type ReviewableStageId, type StageId } from '@/domain/project'
import { canConfirmStage, canGenerate, markDirty, markStageChecked, recordStageVersion, resizeEpisodes } from '@/domain/workflow'
import { createAiAdapter, type AiAdapter } from '@/features/ai'
import { parseSource, sourceTextForAnalysis } from '@/features/files/parse-source'
import { createDebouncedSaver, deleteProject as deleteStoredProject, importProject, listProjects, loadProject } from '@/features/project/persistence'
import type { ProjectSummary } from '@/features/project/persistence'
import { getPromptTemplates } from '@/features/prompts/templates'
import { renderPrompt } from '@/features/prompts/render'
import { ScriptTaskClient } from '@/features/script-tasks/client'
import type { ReviewRequest, ScriptTaskCreate, ScriptTaskResponse } from '@/features/script-tasks/types'
import { StageReviewClient } from '@/features/stage-reviews/client'
import type { StageReviewApi } from '@/features/stage-reviews/types'

const sampleText = `第一章 雨夜来电
临江城暴雨封路。遗产调查员林夏收到一通没有来电号码的电话，对方只说了一句：不要让他们看到信托文件。

第二章 被抹去的名字
林夏在旧档案中发现自己的出生记录与顾氏基金会有关，而记录的最后一页被人为撕走。

第三章 交换条件
顾言带来一份副本，却要求林夏停止调查。就在两人争执时，基金会宣布将在二十四小时后销毁旧档案。`

export const useWorkflowStore = defineStore('workflow', () => {
  const project = ref<Project>(createProject())
  const busyAction = ref<string | null>(null)
  const progress = ref(0)
  const notice = ref('')
  const savingPaused = ref(false)
  const currentTaskId = ref<string | null>(null)
  const projectListVersion = ref(0)
  let adapter: AiAdapter = createAiAdapter()
  let scriptTaskClient: ScriptTaskClient | null = import.meta.env.VITE_SCRIPT_WORKFLOW === 'backend'
    ? new ScriptTaskClient(import.meta.env.VITE_BACKEND_API_URL ?? '')
    : null
  let stageReviewClient: StageReviewApi = new StageReviewClient(import.meta.env.VITE_BACKEND_API_URL ?? '')
  const saveLater = typeof localStorage === 'undefined' ? null : createDebouncedSaver(300)

  watch(project, (value) => saveLater?.(value, (result) => {
    savingPaused.value = !result.ok
    if (result.ok) projectListVersion.value += 1
  }), { deep: true })

  const activeStage = computed(() => project.value.activeStage)
  const completedEpisodes = computed(() => project.value.scripts.filter((item) => item.status === 'confirmed' || item.status === 'ready').length)

  function setAdapter(next: AiAdapter) { adapter = next }
  function setScriptTaskClient(next: ScriptTaskClient | null) { scriptTaskClient = next }
  function setStageReviewClient(next: StageReviewApi) { stageReviewClient = next }
  function setStage(stage: StageId) { project.value.activeStage = stage }
  function renameProject(name: string) { project.value.name = name.trim() || '未命名漫剧项目' }
  function clearNotice() { notice.value = '' }
  function promptFor(id: keyof ReturnType<typeof getPromptTemplates>, variables: Record<string, string | number>) {
    const template = getPromptTemplates()[id]
    return `${template.systemPrompt}\n\n${renderPrompt(template.userTemplate, variables)}`
  }

  function stageSnapshot(stage: ReviewableStageId): Record<string, unknown> {
    if (stage === 'analysis') return { content: project.value.analysis.content }
    if (stage === 'adaptation') {
      const { status: _status, ...content } = project.value.adaptation
      return content
    }
    if (stage === 'planning') {
      const { status: _status, ...content } = project.value.planning
      return content
    }
    return { outlines: project.value.outlines.map(({ episodeNumber, title, content }) => ({ episodeNumber, title, content })) }
  }

  function upstreamContext(stage: ReviewableStageId): Record<string, unknown> {
    if (stage === 'analysis') return { source: project.value.source?.text ?? '' }
    if (stage === 'adaptation') return { analysis: project.value.analysis.content }
    if (stage === 'planning') return { adaptation: stageSnapshot('adaptation') }
    return { planning: stageSnapshot('planning') }
  }

  function ensureStageVersion(stage: ReviewableStageId, source: 'model' | 'human' | 'restored' = 'human') {
    const snapshot = stageSnapshot(stage)
    const latest = project.value.stageReviews[stage].versions.at(-1)
    if (!latest || JSON.stringify(latest.content) !== JSON.stringify(snapshot)) {
      project.value = recordStageVersion(project.value, stage, snapshot, source)
    }
  }

  function confirmStageVersion(stage: ReviewableStageId) {
    const review = project.value.stageReviews[stage]
    const current = review.versions.find((version) => version.version === review.currentVersion)
    if (current) current.confirmed = true
  }

  function applyStageSnapshot(stage: ReviewableStageId, content: Record<string, unknown>) {
    if (stage === 'analysis') {
      project.value = markDirty(project.value, { type: 'analysis' })
      project.value.analysis = { status: 'ready', content: String(content.content ?? '') }
      return
    }
    if (stage === 'adaptation') {
      project.value = markDirty(project.value, { type: 'adaptation' })
      Object.assign(project.value.adaptation, content, { status: 'ready' })
      return
    }
    if (stage === 'planning') {
      project.value = markDirty(project.value, { type: 'planning' })
      Object.assign(project.value.planning, content, { status: 'ready' })
      return
    }
    const outlines = Array.isArray(content.outlines) ? content.outlines : []
    project.value.outlines = outlines.map((item, index) => {
      const value = item as { episodeNumber?: number; title?: string; content?: string }
      return { episodeNumber: value.episodeNumber ?? index + 1, title: value.title ?? '', content: value.content ?? '', status: 'ready', locked: false }
    })
    project.value.scripts.forEach((script) => { if (script.status !== 'empty') script.status = 'dirty' })
    Object.assign(project.value.stageReviews.outlines, { status: 'idle', checkedVersion: null, issues: [], revisionInstructions: [] })
  }

  async function checkStage(stage: ReviewableStageId) {
    ensureStageVersion(stage)
    project.value.stageReviews[stage].status = 'checking'
    project.value.stageReviews[stage].error = undefined
    busyAction.value = `check-${stage}`
    try {
      const result = await stageReviewClient.check({ stage, content: stageSnapshot(stage), upstream_context: upstreamContext(stage) })
      project.value = markStageChecked(project.value, stage, result.passed, result.issues, result.revision_instructions)
      notice.value = result.passed ? 'AI 自查通过，可以人工确认' : `AI 自查发现 ${result.issues.length} 个问题`
    } catch (error) {
      const review = project.value.stageReviews[stage]
      review.status = 'error'
      review.error = error instanceof Error ? error.message : 'AI 自查失败'
      notice.value = review.error
    } finally { busyAction.value = null }
  }

  async function reviseStage(stage: ReviewableStageId, userRequirements = '') {
    ensureStageVersion(stage)
    const review = project.value.stageReviews[stage]
    busyAction.value = `revise-${stage}`
    try {
      const result = await stageReviewClient.revise({
        stage, content: stageSnapshot(stage), upstream_context: upstreamContext(stage),
        issues: review.issues, revision_instructions: review.revisionInstructions,
        user_requirements: userRequirements
      })
      applyStageSnapshot(stage, result.content)
      project.value = recordStageVersion(project.value, stage, stageSnapshot(stage), 'model')
      notice.value = '已生成修订版本，请重新进行 AI 自查'
    } catch (error) {
      const current = project.value.stageReviews[stage]
      current.status = 'error'
      current.error = error instanceof Error ? error.message : '阶段修订失败'
      notice.value = current.error
    } finally { busyAction.value = null }
  }

  function restoreStageVersion(stage: ReviewableStageId, version: number) {
    const item = project.value.stageReviews[stage].versions.find((entry) => entry.version === version)
    if (!item || !item.content || typeof item.content !== 'object') return
    applyStageSnapshot(stage, item.content as Record<string, unknown>)
    project.value = recordStageVersion(project.value, stage, stageSnapshot(stage), 'restored')
    notice.value = `已恢复 V${version}，请重新进行 AI 自查`
  }

  function loadSample() {
    const analysisText = sourceTextForAnalysis(sampleText)
    project.value.source = {
      name: '示例原稿《雨夜来电》.txt', type: 'sample', text: sampleText,
      chapters: [
        { title: '第一章 雨夜来电', content: '临江城暴雨封路。遗产调查员林夏收到神秘电话。' },
        { title: '第二章 被抹去的名字', content: '林夏发现出生记录与顾氏基金会有关。' },
        { title: '第三章 交换条件', content: '顾言带来副本，但基金会即将销毁旧档案。' }
      ],
      characterCount: sampleText.length,
      truncated: analysisText.truncated
    }
    project.value = markDirty(project.value, { type: 'source' })
    notice.value = '已载入示例原稿'
  }

  async function importSourceFile(file: File) {
    busyAction.value = 'import'
    try {
      project.value.source = await parseSource(file)
      project.value = markDirty(project.value, { type: 'source' })
      notice.value = '原稿解析完成'
    } finally { busyAction.value = null }
  }

  async function analyzeSource() {
    if (!project.value.source) throw new Error('请先导入原稿')
    busyAction.value = 'analysis'
    project.value.analysis.status = 'generating'
    project.value.analysis.content = ''
    project.value.analysis.error = undefined
    try {
      const input = sourceTextForAnalysis(project.value.source.text)
      const result = await adapter.analyzeSource(
        { sourceText: input.text, prompt: promptFor('sourceAnalysis', { sourceText: input.text }) },
        { onChunk: (chunk) => { project.value.analysis.content += chunk } }
      )
      project.value.analysis = { status: 'ready', content: result.content }
      project.value = recordStageVersion(project.value, 'analysis', stageSnapshot('analysis'), 'model')
      notice.value = '原稿分析已生成'
    } catch (error) {
      project.value.analysis.status = 'error'
      project.value.analysis.error = error instanceof Error ? error.message : '分析失败'
      notice.value = `原稿分析失败：${project.value.analysis.error}`
    } finally { busyAction.value = null }
  }

  function updateAnalysis(content: string) {
    const next = markDirty(project.value, { type: 'analysis' })
    next.analysis = { status: 'ready', content }
    project.value = next
  }

  function confirmAnalysis() {
    if (!project.value.analysis.content || project.value.analysis.status === 'generating' || !canConfirmStage(project.value, 'analysis').allowed) return
    confirmStageVersion('analysis')
    project.value.analysis.status = 'confirmed'
    project.value.activeStage = 'adaptation'
  }

  async function generateAdaptation() {
    const gate = canGenerate(project.value, 'adaptation')
    if (!gate.allowed) { notice.value = gate.reason ?? '请先完成上游阶段'; return }
    busyAction.value = 'adaptation'
    project.value.adaptation.status = 'generating'
    Object.assign(project.value.adaptation, { direction: '', identity: '', world: '', characters: '' })
    try {
      const variables = { sourceAnalysis: project.value.analysis.content, targetMarket: '竖屏AI漫剧观众', instruction: '保留核心冲突，加强前三集钩子与关键画面表达' }
      const result = await adapter.generateAdaptation(
        { ...variables, prompt: promptFor('adaptationSetup', variables) },
        (partial) => Object.assign(project.value.adaptation, partial)
      )
      Object.assign(project.value.adaptation, result, { status: 'ready' })
      project.value = recordStageVersion(project.value, 'adaptation', stageSnapshot('adaptation'), 'model')
      notice.value = '漫剧设定已生成'
    } catch (error) {
      project.value.adaptation.status = 'error'
      notice.value = `漫剧设定生成失败：${error instanceof Error ? error.message : '未知错误'}`
    } finally { busyAction.value = null }
  }

  function updateAdaptation(field: keyof Omit<AdaptationSetup, 'status'>, value: string) {
    const next = markDirty(project.value, { type: 'adaptation' })
    next.adaptation[field] = value
    next.adaptation.status = 'ready'
    project.value = next
  }

  function confirmAdaptation() {
    if (!project.value.adaptation.direction || project.value.adaptation.status === 'generating' || !canConfirmStage(project.value, 'adaptation').allowed) return
    confirmStageVersion('adaptation')
    project.value.adaptation.status = 'confirmed'
    project.value.activeStage = 'planning'
  }

  async function generatePlan() {
    const gate = canGenerate(project.value, 'planning')
    if (!gate.allowed) { notice.value = gate.reason ?? '请先完成上游阶段'; return }
    busyAction.value = 'planning'
    project.value.planning.status = 'generating'
    Object.assign(project.value.planning, { titleCandidates: [], genre: '', seriesOutline: '', phasePlan: '' })
    try {
      const variables = {
        adaptation: Object.values(project.value.adaptation).join('\n'),
        episodeCount: project.value.planning.episodeCount,
        targetWords: project.value.planning.targetWords
      }
      const result = await adapter.generateSeriesPlan(
        { ...variables, prompt: promptFor('seriesPlanning', variables) },
        (partial) => {
          Object.assign(project.value.planning, partial)
          if (partial.titleCandidates?.length) project.value.planning.title = partial.titleCandidates[0]
        }
      )
      Object.assign(project.value.planning, result, { title: result.titleCandidates[0] ?? '', status: 'ready' })
      project.value = recordStageVersion(project.value, 'planning', stageSnapshot('planning'), 'model')
      notice.value = '全剧规划已生成'
    } catch (error) {
      project.value.planning.status = 'error'
      notice.value = `全剧规划生成失败：${error instanceof Error ? error.message : '未知错误'}`
    } finally { busyAction.value = null }
  }

  function updatePlanning(field: 'title' | 'genre' | 'seriesOutline' | 'phasePlan', value: string) {
    const next = markDirty(project.value, { type: 'planning' })
    next.planning[field] = value
    next.planning.status = 'ready'
    project.value = next
  }

  function updateEpisodeCount(count: number) {
    const next = resizeEpisodes(project.value, count)
    project.value = markDirty(next, { type: 'planning' })
  }

  function updateTargetWords(words: number) {
    project.value.planning.targetWords = Math.min(5000, Math.max(300, Math.round(words)))
  }

  function confirmPlan() {
    if (!project.value.planning.seriesOutline || project.value.planning.status === 'generating' || !canConfirmStage(project.value, 'planning').allowed) return
    confirmStageVersion('planning')
    project.value.planning.status = 'confirmed'
    project.value.activeStage = 'outlines'
  }

  async function generateOutlines() {
    const gate = canGenerate(project.value, 'outlines')
    if (!gate.allowed) { notice.value = gate.reason ?? '请先完成上游阶段'; return }
    busyAction.value = 'outlines'
    progress.value = 0
    try {
      const locked = new Map(project.value.outlines.filter((item) => item.locked).map((item) => [item.episodeNumber, JSON.parse(JSON.stringify(item))]))
      const outlineVariables = { episodeCount: project.value.planning.episodeCount, seriesPlan: `${project.value.planning.seriesOutline}\n${project.value.planning.phasePlan}` }
      const { jobId } = await adapter.createOutlineJob(
        { project: project.value, prompt: promptFor('episodeOutlines', outlineVariables) },
        (outline, nextProgress) => {
          const current = project.value.outlines[outline.episodeNumber - 1]
          if (current && !current.locked) project.value.outlines[outline.episodeNumber - 1] = outline
          progress.value = nextProgress
        }
      )
      while (true) {
        const result = await adapter.getJob(jobId)
        progress.value = result.progress
        if (result.status === 'failed') throw new Error(result.error ?? '分集大纲生成失败')
        if (result.status === 'completed') {
          if (result.outlines) project.value.outlines = result.outlines.map((item) => locked.get(item.episodeNumber) ?? item)
          break
        }
      }
      notice.value = '分集大纲已生成'
      project.value = recordStageVersion(project.value, 'outlines', stageSnapshot('outlines'), 'model')
    } catch (error) {
      notice.value = `分集大纲生成失败：${error instanceof Error ? error.message : '未知错误'}`
    } finally { busyAction.value = null }
  }

  function updateOutline(episodeNumber: number, title: string, content: string) {
    const next = markDirty(project.value, { type: 'outline', episodeNumber })
    const outline = next.outlines[episodeNumber - 1]
    if (!outline) return
    outline.title = title
    outline.content = content
    outline.status = 'ready'
    project.value = next
  }

  function toggleOutlineLock(episodeNumber: number) {
    const outline = project.value.outlines[episodeNumber - 1]
    if (outline) outline.locked = !outline.locked
  }

  function confirmOutline(episodeNumber: number): number {
    const outline = project.value.outlines[episodeNumber - 1]
    if (!outline?.content || busyAction.value === 'outlines' || project.value.outlines.some((item) => item.status === 'generating') || !canConfirmStage(project.value, 'outlines').allowed) return episodeNumber
    outline.status = 'confirmed'
    if (episodeNumber >= project.value.outlines.length) {
      confirmStageVersion('outlines')
      project.value.activeStage = 'scripts'
      return episodeNumber
    }
    return episodeNumber + 1
  }

  function confirmAllOutlines(): boolean {
    if (busyAction.value === 'outlines' || project.value.outlines.some((item) => item.status === 'generating') || !canConfirmStage(project.value, 'outlines').allowed) return false
    const generated = project.value.outlines.filter((item) => item.content)
    if (!generated.length) return false
    generated.forEach((outline) => { outline.status = 'confirmed' })
    confirmStageVersion('outlines')
    project.value.activeStage = 'scripts'
    return true
  }

  async function generateEpisode(episodeNumber: number) {
    const outline = project.value.outlines[episodeNumber - 1]
    const script = project.value.scripts[episodeNumber - 1]
    if (!outline || !script) throw new Error('集数不存在')
    busyAction.value = `script-${episodeNumber}`
    script.status = 'generating'
    script.content = ''
    script.partial = false
    try {
      if (scriptTaskClient) {
        const result = await runBackendEpisode(episodeNumber)
        notice.value = result.status === 'awaiting_human_review'
          ? `第 ${episodeNumber} 集等待人工确认`
          : `第 ${episodeNumber} 集生成完成`
        return
      }
      const context = `${project.value.adaptation.characters}\n${project.value.adaptation.world}`
      const previousSummary = episodeNumber > 1 ? project.value.scripts[episodeNumber - 2].content.slice(-400) : ''
      const variables = { episodeNumber, targetWords: project.value.planning.targetWords, context, previousSummary, outline: outline.content }
      await adapter.generateEpisode({
        episodeNumber,
        outline: outline.content,
        targetWords: project.value.planning.targetWords,
        context,
        previousSummary,
        prompt: promptFor('episodeExpansion', variables)
      }, {
        onStart: (id) => { currentTaskId.value = id },
        onChunk: (chunk) => { script.content += chunk },
        onComplete: () => { script.partial = false }
      })
      script.status = 'ready'
      notice.value = `第 ${episodeNumber} 集生成完成`
    } catch (error) {
      script.partial = script.content.length > 0
      script.status = script.partial ? 'ready' : 'error'
      notice.value = error instanceof Error ? error.message : '漫剧脚本生成失败'
    } finally {
      currentTaskId.value = null
      busyAction.value = null
    }
  }

  async function generateBatch(startEpisode = 1) {
    busyAction.value = 'batch-scripts'
    try {
      const targets = project.value.outlines.filter((outline) => outline.episodeNumber >= startEpisode && outline.status === 'confirmed')
      for (const outline of targets) {
        const script = project.value.scripts[outline.episodeNumber - 1]
        if (script.content && (script.status === 'confirmed' || script.status === 'ready')) continue
        await generateEpisode(outline.episodeNumber)
      }
      notice.value = '批量生成已完成'
    } finally { busyAction.value = null }
  }

  async function rewriteEpisode(episodeNumber: number, instruction: string) {
    const outline = project.value.outlines[episodeNumber - 1]
    const script = project.value.scripts[episodeNumber - 1]
    if (!outline || !script) throw new Error('集数不存在')
    const previous = script.content
    script.content = ''
    script.status = 'generating'
    busyAction.value = `rewrite-${episodeNumber}`
    try {
      if (scriptTaskClient) {
        await runBackendEpisode(episodeNumber, instruction, previous)
        return
      }
      await adapter.rewriteEpisode({
        episodeNumber, outline: outline.content, targetWords: project.value.planning.targetWords,
        script: previous, instruction,
        prompt: promptFor('episodeRewrite', { instruction, outline: outline.content, script: previous })
      }, {
        onStart: (id) => { currentTaskId.value = id },
        onChunk: (chunk) => { script.content += chunk }
      })
      script.status = 'ready'
      script.partial = false
    } catch (error) {
      script.partial = script.content.length > 0
      script.status = script.partial ? 'ready' : 'error'
      notice.value = error instanceof Error ? error.message : '剧本重写失败'
    } finally { currentTaskId.value = null; busyAction.value = null }
  }

  async function stopCurrentGeneration() {
    if (!currentTaskId.value) return
    if (scriptTaskClient) {
      const script = project.value.scripts.find((item) => item.taskId === currentTaskId.value)
      if (script) await cancelScriptTask(script.episodeNumber)
      return
    }
    await adapter.stopGeneration(currentTaskId.value)
  }

  async function reviewScriptTask(episodeNumber: number, review: ReviewRequest) {
    const script = project.value.scripts[episodeNumber - 1]
    if (!scriptTaskClient || !script?.taskId) throw new Error('当前剧本没有可审核的后端任务')
    busyAction.value = `review-${episodeNumber}`
    script.status = 'generating'
    try {
      applyBackendTask(script, await scriptTaskClient.review(script.taskId, review))
      const result = await scriptTaskClient.waitForReview(script.taskId, {
        onUpdate: (task) => applyBackendTask(script, task)
      })
      applyBackendTask(script, result)
      if (result.status === 'model_failed' || result.status === 'validation_failed') {
        notice.value = result.error_message ?? '后端剧本修订失败'
        return
      }
      if (result.status === 'cancelled') {
        notice.value = `第 ${episodeNumber} 集任务已取消`
        return
      }
      await loadScriptVersions(episodeNumber)
      notice.value = result.status === 'completed' ? `第 ${episodeNumber} 集已确认` : `第 ${episodeNumber} 集修订完成，等待确认`
    } catch (error) {
      script.status = script.content ? 'ready' : 'error'
      notice.value = error instanceof Error ? error.message : '剧本审核操作失败'
      throw error
    } finally {
      busyAction.value = null
    }
  }

  async function loadScriptVersions(episodeNumber: number) {
    const script = project.value.scripts[episodeNumber - 1]
    if (!scriptTaskClient || !script?.taskId) return []
    const versions = await scriptTaskClient.versions(script.taskId)
    script.versions = versions
    return versions
  }

  async function cancelScriptTask(episodeNumber: number) {
    const script = project.value.scripts[episodeNumber - 1]
    if (!scriptTaskClient || !script?.taskId) return
    const result = await scriptTaskClient.cancel(script.taskId)
    applyBackendTask(script, result)
    script.status = script.content ? 'ready' : 'empty'
    if (currentTaskId.value === script.taskId) currentTaskId.value = null
  }

  async function runBackendEpisode(episodeNumber: number, instruction = '', currentScript = '') {
    const outline = project.value.outlines[episodeNumber - 1]
    const script = project.value.scripts[episodeNumber - 1]
    if (!scriptTaskClient || !outline || !script) throw new Error('后端剧本任务不可用')
    const previousSummary = episodeNumber > 1 ? project.value.scripts[episodeNumber - 2].content.slice(-400) : ''
    const userRequirements = [instruction, currentScript ? `当前剧本：\n${currentScript}` : ''].filter(Boolean).join('\n\n')
    const payload: ScriptTaskCreate = {
      project_id: project.value.id,
      episode_id: `${project.value.id}-episode-${episodeNumber}`,
      episode_number: episodeNumber,
      episode_outline: outline.content,
      character_context: project.value.adaptation.characters,
      world_context: project.value.adaptation.world,
      previous_episode_summary: previousSummary,
      user_requirements: userRequirements,
      target_words: project.value.planning.targetWords,
      max_retries: 2
    }
    const created = await scriptTaskClient.create(payload)
    applyBackendTask(script, created)
    currentTaskId.value = created.task_id
    const result = await scriptTaskClient.waitForReview(created.task_id, {
      onUpdate: (task) => applyBackendTask(script, task)
    })
    applyBackendTask(script, result)
    if (['model_failed', 'validation_failed'].includes(result.status)) {
      throw new Error(result.error_message ?? '后端剧本生成失败')
    }
    if (result.status === 'awaiting_human_review' || result.status === 'completed') await loadScriptVersions(episodeNumber)
    return result
  }

  function applyBackendTask(script: EpisodeScript, task: ScriptTaskResponse) {
    script.taskId = task.task_id
    script.taskStatus = task.status
    script.taskStage = task.current_stage
    script.taskProgress = task.progress
    script.retryCount = task.retry_count
    script.maxRetries = task.max_retries
    script.qualityCheck = task.quality_check_result
    script.taskErrorCode = task.error_code
    script.taskErrorMessage = task.error_message
    if (task.script_content) script.content = task.script_content
    if (task.status === 'completed' && task.final_approved) script.status = 'confirmed'
    else if (task.status === 'awaiting_human_review') script.status = 'ready'
    else if (task.status === 'cancelled') script.status = script.content ? 'ready' : 'empty'
    else if (task.status === 'model_failed' || task.status === 'validation_failed') script.status = script.content ? 'ready' : 'error'
    else script.status = 'generating'
  }

  function updateScript(episodeNumber: number, content: string) {
    const next = markDirty(project.value, { type: 'script', episodeNumber })
    const script = next.scripts[episodeNumber - 1]
    if (script) { script.content = content; script.status = 'ready' }
    project.value = next
  }

  function confirmScript(episodeNumber: number): number {
    const script = project.value.scripts[episodeNumber - 1]
    if (!script?.content || busyAction.value || project.value.scripts.some((item) => item.status === 'generating')) return episodeNumber
    if (script.taskId && script.taskStatus !== 'completed') return episodeNumber
    script.status = 'confirmed'
    return Math.min(episodeNumber + 1, project.value.scripts.length)
  }

  function confirmAllScripts(): boolean {
    if (busyAction.value || project.value.scripts.some((item) => item.status === 'generating')) return false
    if (project.value.scripts.some((item) => item.taskId && item.taskStatus !== 'completed')) return false
    const generated = project.value.scripts.filter((item) => item.content)
    if (!generated.length) return false
    generated.forEach((script) => { script.status = 'confirmed' })
    return true
  }

  function restore(projectId: string): boolean {
    const restored = loadProject(projectId)
    if (!restored) return false
    project.value = restored
    projectListVersion.value += 1
    notice.value = `已打开项目：${restored.name}`
    return true
  }

  function getProjectRecords(): ProjectSummary[] {
    void projectListVersion.value
    return listProjects()
  }

  function removeProject(projectId: string): boolean {
    const result = deleteStoredProject(projectId)
    if (!result.ok) { notice.value = result.error ?? '项目删除失败'; return false }
    if (projectId === project.value.id) project.value = createProject()
    projectListVersion.value += 1
    notice.value = '项目记录已删除'
    return true
  }

  function importProjectJson(raw: string): boolean {
    const result = importProject(raw, project.value)
    if (!result.ok) { notice.value = result.error ?? '项目导入失败'; return false }
    project.value = result.project
    notice.value = '项目导入成功'
    return true
  }

  function resetProject() { project.value = createProject(); notice.value = '已创建新项目' }

  return {
    project, activeStage, busyAction, progress, notice, savingPaused, completedEpisodes, currentTaskId, projectListVersion,
    setAdapter, setScriptTaskClient, setStageReviewClient, setStage, renameProject, clearNotice, loadSample, importSourceFile,
    checkStage, reviseStage, restoreStageVersion,
    analyzeSource, updateAnalysis, confirmAnalysis, generateAdaptation, updateAdaptation, confirmAdaptation,
    generatePlan, updatePlanning, updateEpisodeCount, updateTargetWords, confirmPlan,
    generateOutlines, updateOutline, toggleOutlineLock, confirmOutline, confirmAllOutlines,
    generateEpisode, generateBatch, rewriteEpisode, stopCurrentGeneration, reviewScriptTask, loadScriptVersions, cancelScriptTask,
    updateScript, confirmScript, confirmAllScripts,
    restore, getProjectRecords, removeProject, importProjectJson, resetProject
  }
})
