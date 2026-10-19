import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createProject, type AdaptationSetup, type Project, type StageId } from '@/domain/project'
import { markDirty, resizeEpisodes } from '@/domain/workflow'
import { createAiAdapter, type AiAdapter } from '@/features/ai'
import { parseSource, sourceTextForAnalysis } from '@/features/files/parse-source'
import { createDebouncedSaver, importProject, loadProject } from '@/features/project/persistence'
import { getPromptTemplates } from '@/features/prompts/templates'
import { renderPrompt } from '@/features/prompts/render'

const sampleText = `第一章 关键文件
某个项目中出现一份内容不完整的关键文件，主角开始核对记录并寻找缺失信息。

第二章 新的线索
主角在已有资料中发现几处不一致，并通过交叉核对逐步缩小调查范围。

第三章 阶段确认
一名协作者提供补充材料，双方核实信息后整理出阶段性结论。`

export const useWorkflowStore = defineStore('workflow', () => {
  const project = ref<Project>(createProject())
  const busyAction = ref<string | null>(null)
  const progress = ref(0)
  const notice = ref('')
  const savingPaused = ref(false)
  const currentTaskId = ref<string | null>(null)
  let adapter: AiAdapter = createAiAdapter()
  const saveLater = typeof localStorage === 'undefined' ? null : createDebouncedSaver(300)

  watch(project, (value) => saveLater?.(value, (result) => { savingPaused.value = !result.ok }), { deep: true })

  const activeStage = computed(() => project.value.activeStage)
  const completedEpisodes = computed(() => project.value.scripts.filter((item) => item.status === 'confirmed' || item.status === 'ready').length)

  function setAdapter(next: AiAdapter) { adapter = next }
  function setStage(stage: StageId) { project.value.activeStage = stage }
  function renameProject(name: string) { project.value.name = name.trim() || '未命名漫剧项目' }
  function clearNotice() { notice.value = '' }
  function promptFor(id: keyof ReturnType<typeof getPromptTemplates>, variables: Record<string, string | number>) {
    const template = getPromptTemplates()[id]
    return `${template.systemPrompt}\n\n${renderPrompt(template.userTemplate, variables)}`
  }

  function loadSample() {
    const analysisText = sourceTextForAnalysis(sampleText)
    project.value.source = {
      name: '示例原稿《关键文件》.txt', type: 'sample', text: sampleText,
      chapters: [
        { title: '第一章 关键文件', content: '发现一份内容不完整的关键文件，开始核对记录。' },
        { title: '第二章 新的线索', content: '发现资料之间存在不一致，并逐步缩小核查范围。' },
        { title: '第三章 阶段确认', content: '补充材料经过核实，形成阶段性结论。' }
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
      notice.value = '原稿分析已生成'
    } catch (error) {
      project.value.analysis.status = 'error'
      project.value.analysis.error = error instanceof Error ? error.message : '分析失败'
      notice.value = `原稿分析失败：${project.value.analysis.error}`
    } finally { busyAction.value = null }
  }

  function confirmAnalysis() {
    if (!project.value.analysis.content || project.value.analysis.status === 'generating') return
    project.value.analysis.status = 'confirmed'
    project.value.activeStage = 'adaptation'
  }

  async function generateAdaptation() {
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
    if (!project.value.adaptation.direction || project.value.adaptation.status === 'generating') return
    project.value.adaptation.status = 'confirmed'
    project.value.activeStage = 'planning'
  }

  async function generatePlan() {
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
    if (!project.value.planning.seriesOutline || project.value.planning.status === 'generating') return
    project.value.planning.status = 'confirmed'
    project.value.activeStage = 'outlines'
  }

  async function generateOutlines() {
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
    if (!outline?.content || busyAction.value === 'outlines' || project.value.outlines.some((item) => item.status === 'generating')) return episodeNumber
    outline.status = 'confirmed'
    if (episodeNumber >= project.value.outlines.length) {
      project.value.activeStage = 'scripts'
      return episodeNumber
    }
    return episodeNumber + 1
  }

  function confirmAllOutlines(): boolean {
    if (busyAction.value === 'outlines' || project.value.outlines.some((item) => item.status === 'generating')) return false
    const generated = project.value.outlines.filter((item) => item.content)
    if (!generated.length) return false
    generated.forEach((outline) => { outline.status = 'confirmed' })
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
    if (currentTaskId.value) await adapter.stopGeneration(currentTaskId.value)
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
    script.status = 'confirmed'
    return Math.min(episodeNumber + 1, project.value.scripts.length)
  }

  function confirmAllScripts(): boolean {
    if (busyAction.value || project.value.scripts.some((item) => item.status === 'generating')) return false
    const generated = project.value.scripts.filter((item) => item.content)
    if (!generated.length) return false
    generated.forEach((script) => { script.status = 'confirmed' })
    return true
  }

  function restore(projectId: string): boolean {
    const restored = loadProject(projectId)
    if (!restored) return false
    project.value = restored
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
    project, activeStage, busyAction, progress, notice, savingPaused, completedEpisodes, currentTaskId,
    setAdapter, setStage, renameProject, clearNotice, loadSample, importSourceFile,
    analyzeSource, confirmAnalysis, generateAdaptation, updateAdaptation, confirmAdaptation,
    generatePlan, updatePlanning, updateEpisodeCount, updateTargetWords, confirmPlan,
    generateOutlines, updateOutline, toggleOutlineLock, confirmOutline, confirmAllOutlines,
    generateEpisode, generateBatch, rewriteEpisode, stopCurrentGeneration, updateScript, confirmScript, confirmAllScripts,
    restore, importProjectJson, resetProject
  }
})
