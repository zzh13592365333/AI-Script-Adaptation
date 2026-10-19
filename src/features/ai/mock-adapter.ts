import type { EpisodeOutline } from '@/domain/project'
import type { AdaptationResult, AiAdapter, EpisodeGenerationInput, OutlineJobStatus, OutlineStreamCallback, PartialResultCallback, SeriesPlanResult, StreamCallbacks, RewriteInput } from './adapter'

interface MockOptions { latencyMs?: number }
interface InternalJob { input: Parameters<AiAdapter['createOutlineJob']>[0]; progress: number }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class MockAiAdapter implements AiAdapter {
  private latencyMs: number
  private jobs = new Map<string, InternalJob>()
  private stopped = new Set<string>()

  constructor(options: MockOptions = {}) { this.latencyMs = options.latencyMs ?? 180 }

  async analyzeSource(
    _input: Parameters<AiAdapter['analyzeSource']>[0],
    callbacks?: StreamCallbacks
  ): Promise<{ content: string }> {
    const chunks = [
      '【题材】悬疑与调查\n【核心卖点】主角通过核对线索逐步发现关键信息。\n',
      '【主角线】从发现问题到核实信息并解决问题。\n【视觉看点】资料对照、线索整理、关键发现。\n',
      '【漫剧建议】明确每一阶段的目标、线索和结果，减少重复信息。'
    ]
    for (const chunk of chunks) {
      await wait(this.latencyMs)
      callbacks?.onChunk(chunk)
    }
    return { content: chunks.join('') }
  }

  async generateAdaptation(_input: Parameters<AiAdapter['generateAdaptation']>[0], onPartial?: PartialResultCallback<AdaptationResult>): Promise<AdaptationResult> {
    const result: AdaptationResult = {
      direction: '面向竖屏内容观众，以逐步发现线索、核实信息和解决问题为主线，画面表达清晰、节奏紧凑。',
      identity: '主角A负责核对关键资料，逐步发现文件之间存在不一致。',
      world: '虚构城市A。工作团队、资料管理部门和协作人员构成主要关系网络。',
      characters: '主角A：负责核查信息；角色B：提供补充材料；角色C：负责复核阶段结论。'
    }
    for (const field of ['direction', 'identity', 'world', 'characters'] as const) {
      await wait(this.latencyMs)
      onPartial?.({ [field]: result[field] })
    }
    return result
  }

  async generateSeriesPlan(input: { episodeCount: number }, onPartial?: PartialResultCallback<SeriesPlanResult>): Promise<SeriesPlanResult> {
    const result: SeriesPlanResult = {
      titleCandidates: ['《关键线索》', '《资料之外》', '《阶段结论》'],
      genre: '悬疑调查',
      seriesOutline: `全剧共 ${input.episodeCount} 集。主角A从一份异常资料入手，逐步核实相关记录，在协作与分歧中补全信息并形成结论。`,
      phasePlan: '起始：发现资料异常；推进：收集补充线索；核查：交叉验证记录；解决：补全关键信息；收束：整理并确认结论。'
    }
    for (const field of ['titleCandidates', 'genre', 'seriesOutline', 'phasePlan'] as const) {
      await wait(this.latencyMs)
      onPartial?.({ [field]: result[field] })
    }
    return result
  }

  async createOutlineJob(input: Parameters<AiAdapter['createOutlineJob']>[0], onOutline?: OutlineStreamCallback): Promise<{ jobId: string }> {
    const jobId = crypto.randomUUID()
    this.jobs.set(jobId, { input: JSON.parse(JSON.stringify(input)), progress: 0 })
    for (const current of input.project.outlines) {
      if (current.locked) continue
      await wait(Math.min(this.latencyMs, 10))
      onOutline?.({
        ...current,
        title: `第 ${current.episodeNumber} 集 · ${current.episodeNumber === 1 ? '发现关键差异' : '线索继续收紧'}`,
        content: `第 ${current.episodeNumber} 集：开场以新的证据或威胁形成画面钩子，主角A推进核查并发现新的信息差异；结尾以待验证的问题形成悬念。`,
        status: 'ready'
      }, Math.min(99, Math.round(current.episodeNumber / input.project.outlines.length * 100)))
    }
    return { jobId }
  }

  async getJob(jobId: string): Promise<OutlineJobStatus> {
    const job = this.jobs.get(jobId)
    if (!job) return { jobId, status: 'failed', progress: 0, error: '任务不存在' }
    await wait(this.latencyMs)
    job.progress = Math.min(100, job.progress + 40)
    if (job.progress < 100) return { jobId, status: 'running', progress: job.progress }
    const outlines: EpisodeOutline[] = job.input.project.outlines.map((current) => current.locked ? current : {
      ...current,
      title: `第 ${current.episodeNumber} 集 · ${current.episodeNumber === 1 ? '发现关键差异' : '线索继续收紧'}`,
      content: `第 ${current.episodeNumber} 集：开场以新的证据或威胁形成画面钩子，主角A推进核查并发现新的信息差异；结尾以待验证的问题形成悬念。`,
      status: 'ready'
    })
    return { jobId, status: 'completed', progress: 100, outlines }
  }

  async generateEpisode(input: EpisodeGenerationInput, callbacks: StreamCallbacks): Promise<void> {
    return this.streamScript(input, callbacks)
  }

  async rewriteEpisode(input: RewriteInput, callbacks: StreamCallbacks): Promise<void> {
    return this.streamScript({ ...input, outline: `${input.outline}\n重写要求：${input.instruction}` }, callbacks)
  }

  async stopGeneration(taskId: string): Promise<void> { this.stopped.add(taskId) }

  private async streamScript(input: EpisodeGenerationInput, callbacks: StreamCallbacks): Promise<void> {
    const taskId = crypto.randomUUID()
    callbacks.onStart?.(taskId)
    const chunks = [
      `第 ${input.episodeNumber} 集\n\n1. 内景 · 调查事务所 · 日\n`,
      '主角A将两份资料放在桌面。\n主角A：这两处记录不一致，需要进一步核实。\n',
      '协作者B带着补充材料走进来。\n协作者B：我找到了可以交叉核对的记录。\n',
      `主角A抬起头，继续整理资料。\n主角A：我们先核实记录，再确认结论。\n\n【本集悬念】${input.outline}`
    ]
    for (const chunk of chunks) {
      if (this.stopped.has(taskId)) {
        this.stopped.delete(taskId)
        throw new Error('生成已停止')
      }
      await wait(this.latencyMs)
      if (this.stopped.has(taskId)) {
        this.stopped.delete(taskId)
        throw new Error('生成已停止')
      }
      callbacks.onChunk(chunk)
    }
    callbacks.onComplete?.()
  }
}
