import type { EpisodeOutline } from '@/domain/project'
import type {
  AdaptationResult,
  AiAdapter,
  EpisodeGenerationInput,
  OutlineJobStatus,
  OutlineStreamCallback,
  PartialResultCallback,
  RewriteInput,
  SeriesPlanResult,
  StreamCallbacks
} from './adapter'
import { normalizeAdaptationResult, normalizeSeriesPlanResult } from './normalize-output'

interface ChatResponse { content: string }
interface ChatInput { prompt?: string }

const structuredInstructions = {
  adaptation: '仅输出 JSON，不要 Markdown。字段必须为 direction、identity、world、characters，值均为字符串。',
  planning: '仅输出 JSON，不要 Markdown。titleCandidates 必须是字符串数组；genre、seriesOutline、phasePlan 必须是字符串，禁止返回对象或对象数组。',
  outlines: '仅输出 JSON，不要 Markdown。格式为 {"outlines":[{"episodeNumber":1,"title":"标题","content":"大纲"}]}，必须覆盖要求的全部集数。'
}

export class HttpAiAdapter implements AiAdapter {
  private jobs = new Map<string, OutlineJobStatus>()
  private controllers = new Map<string, AbortController>()

  constructor(private baseUrl: string) {}

  private async chat(prompt: string, stream = false, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/openai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream }),
      credentials: 'include',
      signal
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(detail?.error ?? `请求失败：${response.status}`)
    }
    return response
  }

  private prompt(input: ChatInput, fallback: string): string {
    return input.prompt?.trim() || fallback
  }

  private async text(input: ChatInput, fallback: string): Promise<string> {
    const response = await this.chat(this.prompt(input, fallback))
    const payload = await response.json() as ChatResponse
    return payload.content
  }

  private async structured<T>(prompt: string): Promise<T> {
    const response = await this.chat(prompt)
    const payload = await response.json() as ChatResponse
    return parseStructuredJson<T>(payload.content)
  }

  async analyzeSource(input: Parameters<AiAdapter['analyzeSource']>[0], callbacks?: StreamCallbacks) {
    const prompt = this.prompt(input, `分析以下原稿：\n${input.sourceText}`)
    const content = await this.stream(prompt, callbacks ?? { onChunk: () => undefined })
    return { content }
  }

  async generateAdaptation(
    input: Parameters<AiAdapter['generateAdaptation']>[0],
    onPartial?: PartialResultCallback<AdaptationResult>
  ) {
    const fallback = `根据原稿分析生成漫剧设定。\n${input.sourceAnalysis}\n目标：${input.targetMarket}\n要求：${input.instruction}`
    let streamed = ''
    const content = await this.stream(`${this.prompt(input, fallback)}\n\n${structuredInstructions.adaptation}`, {
      onChunk: (chunk) => {
        streamed += chunk
        onPartial?.(extractStringFields<AdaptationResult>(streamed, ['direction', 'identity', 'world', 'characters']))
      }
    })
    return normalizeAdaptationResult(parseStructuredJson<unknown>(content))
  }

  async generateSeriesPlan(
    input: Parameters<AiAdapter['generateSeriesPlan']>[0],
    onPartial?: PartialResultCallback<SeriesPlanResult>
  ) {
    const fallback = `规划 ${input.episodeCount} 集漫剧，每集约 ${input.targetWords} 字。\n${input.adaptation}`
    let streamed = ''
    const content = await this.stream(`${this.prompt(input, fallback)}\n\n${structuredInstructions.planning}`, {
      onChunk: (chunk) => {
        streamed += chunk
        const partial = extractStringFields<SeriesPlanResult>(streamed, ['genre', 'seriesOutline', 'phasePlan'])
        const titleCandidates = extractStringArrayField(streamed, 'titleCandidates')
        if (titleCandidates.length) partial.titleCandidates = titleCandidates
        onPartial?.(partial)
      }
    })
    return normalizeSeriesPlanResult(parseStructuredJson<unknown>(content))
  }

  async createOutlineJob(input: Parameters<AiAdapter['createOutlineJob']>[0], onOutline?: OutlineStreamCallback) {
    const jobId = crypto.randomUUID()
    this.jobs.set(jobId, { jobId, status: 'running', progress: 10 })
    try {
      const fallback = `生成 ${input.project.planning.episodeCount} 集分集大纲。\n${input.project.planning.seriesOutline}\n${input.project.planning.phasePlan}`
      let streamed = ''
      const emitted = new Set<number>()
      const content = await this.stream(`${this.prompt(input, fallback)}\n\n${structuredInstructions.outlines}`, {
        onChunk: (chunk) => {
          streamed += chunk
          for (const outline of extractOutlineObjects(streamed)) {
            if (emitted.has(outline.episodeNumber)) continue
            emitted.add(outline.episodeNumber)
            onOutline?.(toEpisodeOutline(outline), Math.min(99, Math.round(emitted.size / input.project.planning.episodeCount * 100)))
          }
        }
      })
      const result = parseStructuredJson<{ outlines: Array<Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>> }>(content)
      const outlines: EpisodeOutline[] = result.outlines.map((outline) => ({
        ...toEpisodeOutline(outline)
      }))
      this.jobs.set(jobId, { jobId, status: 'completed', progress: 100, outlines })
    } catch (error) {
      this.jobs.set(jobId, { jobId, status: 'failed', progress: 100, error: error instanceof Error ? error.message : '分集大纲生成失败' })
    }
    return { jobId }
  }

  async getJob(jobId: string): Promise<OutlineJobStatus> {
    return this.jobs.get(jobId) ?? { jobId, status: 'failed', progress: 0, error: '任务不存在' }
  }

  async generateEpisode(input: EpisodeGenerationInput, callbacks: StreamCallbacks): Promise<void> {
    const fallback = `扩写第 ${input.episodeNumber} 集，目标 ${input.targetWords} 字。\n${input.outline}`
    await this.stream(this.prompt(input, fallback), callbacks)
  }

  async rewriteEpisode(input: RewriteInput, callbacks: StreamCallbacks): Promise<void> {
    const fallback = `按要求重写第 ${input.episodeNumber} 集。\n要求：${input.instruction}\n大纲：${input.outline}\n原稿：${input.script}`
    await this.stream(this.prompt(input, fallback), callbacks)
  }

  async stopGeneration(taskId: string) {
    this.controllers.get(taskId)?.abort()
  }

  private async stream(prompt: string, callbacks: StreamCallbacks): Promise<string> {
    const taskId = crypto.randomUUID()
    const controller = new AbortController()
    this.controllers.set(taskId, controller)
    callbacks.onStart?.(taskId)
    let content = ''
    try {
      const response = await this.chat(prompt, true, controller.signal)
      if (!response.body) throw new Error('模型接口未返回流式响应')
      await readOpenAiStream(response.body, (chunk) => {
        content += chunk
        callbacks.onChunk(chunk)
      })
      callbacks.onComplete?.()
      return content
    } catch (error) {
      if (controller.signal.aborted) throw new Error('生成已停止')
      throw error
    } finally {
      this.controllers.delete(taskId)
    }
  }
}

function toEpisodeOutline(outline: Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>): EpisodeOutline {
  return {
    episodeNumber: outline.episodeNumber,
    title: outline.title ?? `第 ${outline.episodeNumber} 集`,
    content: outline.content ?? '',
    status: 'ready',
    locked: false
  }
}

function extractStringFields<T extends object>(source: string, fields: string[]): Partial<T> {
  const partial: Record<string, string> = {}
  for (const field of fields) {
    const value = extractJsonStringField(source, field)
    if (value !== undefined) partial[field] = value
  }
  return partial as Partial<T>
}

function extractJsonStringField(source: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(source)
  if (!match) return undefined
  let value = ''
  let escaped = false
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      if (char === 'n') value += '\n'
      else if (char === 'r') value += '\r'
      else if (char === 't') value += '\t'
      else value += char
      escaped = false
    } else if (char === '\\') escaped = true
    else if (char === '"') break
    else value += char
  }
  return value
}

function extractStringArrayField(source: string, field: string): string[] {
  const match = new RegExp(`"${field}"\\s*:\\s*\\[`).exec(source)
  if (!match) return []
  const values: string[] = []
  const remaining = source.slice(match.index + match[0].length)
  const arrayEnd = remaining.indexOf(']')
  const tail = arrayEnd >= 0 ? remaining.slice(0, arrayEnd) : remaining
  const pattern = /"((?:\\.|[^"\\])*)"/g
  for (const item of tail.matchAll(pattern)) {
    try { values.push(JSON.parse(`"${item[1]}"`) as string) } catch { /* Wait for the next chunk. */ }
  }
  return values
}

function extractOutlineObjects(source: string): Array<Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>> {
  const match = /"outlines"\s*:\s*\[/.exec(source)
  if (!match) return []
  const results: Array<Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>> = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          results.push(JSON.parse(source.slice(start, index + 1)) as Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>)
        } catch { /* Ignore an incomplete object. */ }
        start = -1
      }
    }
  }
  return results.filter((outline) => Number.isInteger(outline.episodeNumber))
}

function parseStructuredJson<T>(content: string): T {
  const trimmed = content.trim()
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const objectStart = unfenced.indexOf('{')
  const arrayStart = unfenced.indexOf('[')
  const starts = [objectStart, arrayStart].filter((index) => index >= 0)
  const candidate = starts.length ? unfenced.slice(Math.min(...starts)) : unfenced
  try {
    return JSON.parse(candidate) as T
  } catch {
    throw new Error('模型未返回有效的结构化 JSON，请调整提示词后重试')
  }
}

async function readOpenAiStream(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = done ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!data || data === '[DONE]') continue
      try {
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
        const content = event.choices?.[0]?.delta?.content
        if (content) onChunk(content)
      } catch { /* Ignore non-JSON SSE keepalive events. */ }
    }
    if (done) break
  }
}
