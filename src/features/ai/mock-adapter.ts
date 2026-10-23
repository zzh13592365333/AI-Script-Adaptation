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
      '【题材】都市悬疑与身份逆袭\n【核心卖点】被低估的继承人夺回人生主动权。\n',
      '【主角线】从隐忍求生到公开反击。\n【视觉看点】雨夜来电、撕毁档案、信托文件对峙。\n',
      '【漫剧建议】强化前三集画面钩子，压缩重复误会。'
    ]
    for (const chunk of chunks) {
      await wait(this.latencyMs)
      callbacks?.onChunk(chunk)
    }
    return { content: chunks.join('') }
  }

  async generateAdaptation(_input: Parameters<AiAdapter['generateAdaptation']>[0], onPartial?: PartialResultCallback<AdaptationResult>): Promise<AdaptationResult> {
    const result: AdaptationResult = {
      direction: '面向竖屏漫剧观众，以家族权力斗争、身份谜团和情感背叛为主线，画面钩子明确、节奏直接。',
      identity: '女主林夏是被收养家庭压制的遗产调查员，真实身份与一份失踪信托有关。',
      world: '当代临江城。家族基金会、私人调查机构和地方媒体构成主要权力网络。',
      characters: '林夏：冷静克制的调查员；顾言：利益与感情冲突的继承人；顾曼：掌控家族资源的对手。'
    }
    for (const field of ['direction', 'identity', 'world', 'characters'] as const) {
      await wait(this.latencyMs)
      onPartial?.({ [field]: result[field] })
    }
    return result
  }

  async generateSeriesPlan(input: { episodeCount: number }, onPartial?: PartialResultCallback<SeriesPlanResult>): Promise<SeriesPlanResult> {
    const result: SeriesPlanResult = {
      titleCandidates: ['《逆光继承人》', '《她的第二身份》', '《失落信托》'],
      genre: '都市情感 / 身份逆袭',
      seriesOutline: `全剧共 ${input.episodeCount} 集。林夏从一宗异常遗产案入手，发现自己的身世被人为抹除，在盟友与对手不断易位的过程中夺回证据与选择权。`,
      phasePlan: '起势：遗嘱异常；升级：身份线索出现；失控：证据被夺；反击：公开交易记录；收束：真相与关系完成回报。'
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
        title: `第 ${current.episodeNumber} 集 · ${current.episodeNumber === 1 ? '被改写的遗嘱' : '线索继续收紧'}`,
        content: `第 ${current.episodeNumber} 集：开场以新的证据或威胁形成画面钩子，林夏推进调查并迫使对手暴露一层目的；结尾以关系反转或证据失控形成悬念。`,
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
      title: `第 ${current.episodeNumber} 集 · ${current.episodeNumber === 1 ? '被改写的遗嘱' : '线索继续收紧'}`,
      content: `第 ${current.episodeNumber} 集：开场以新的证据或威胁形成画面钩子，林夏推进调查并迫使对手暴露一层目的；结尾以关系反转或证据失控形成悬念。`,
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
      '林夏将一份泛黄的信托文件压在桌面。\n林夏：签名是真的，但日期被人动过。\n',
      '门外传来急促脚步，顾言推门而入。\n顾言：他们已经知道你拿到了副本。\n',
      `林夏抬眼，没有收起文件。\n林夏：那就让他们来。\n\n【本集悬念】${input.outline}`
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
