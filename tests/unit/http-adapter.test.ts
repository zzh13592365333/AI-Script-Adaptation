import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpAiAdapter } from '@/features/ai/http-adapter'

afterEach(() => vi.unstubAllGlobals())

describe('HttpAiAdapter OpenAI-compatible transport', () => {
  it('surfaces sanitized FastAPI error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '模型服务尚未完整配置' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })))
    const adapter = new HttpAiAdapter('/api')

    await expect(adapter.analyzeSource({ sourceText: '原稿' }, { onChunk: () => undefined })).rejects.toThrow('模型服务尚未完整配置')
  })

  it('streams analysis text through the local proxy and returns the complete result', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"分析"}}]}\n\ndata: {"choices":[{"delta":{"content":"结果"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new HttpAiAdapter('/api')
    const chunks: string[] = []
    await expect(adapter.analyzeSource(
      { sourceText: '原稿', prompt: '分析这个原稿' },
      { onChunk: (chunk) => chunks.push(chunk) }
    )).resolves.toEqual({ content: '分析结果' })
    expect(chunks).toEqual(['分析', '结果'])
    expect(fetchMock).toHaveBeenCalledWith('/api/openai/chat', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toBe('分析这个原稿')
    expect(body.stream).toBe(true)
  })

  it('parses structured adaptation output', async () => {
    const content = JSON.stringify({ direction: '方向', identity: '身份', world: '世界', characters: '人物' })
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
    const adapter = new HttpAiAdapter('/api')
    await expect(adapter.generateAdaptation({ sourceAnalysis: '分析', targetMarket: '漫剧', instruction: '', prompt: '生成设定' })).resolves.toEqual(JSON.parse(content))
  })

  it('publishes adaptation fields while structured JSON is streaming', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"direction\\":\\"实时方向"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，继续\\",\\"identity\\":\\"核心身份\\",\\"world\\":\\"世界\\",\\"characters\\":\\"人物\\"}"}}]}\n\n',
      'data: [DONE]\n\n'
    ].join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
    const adapter = new HttpAiAdapter('/api')
    const partials: Array<Record<string, unknown>> = []
    const result = await adapter.generateAdaptation(
      { sourceAnalysis: '分析', targetMarket: '漫剧', instruction: '', prompt: '生成设定' },
      (partial) => partials.push(partial)
    )
    expect(partials.some((partial) => partial.direction === '实时方向')).toBe(true)
    expect(partials.some((partial) => partial.direction === '实时方向，继续')).toBe(true)
    expect(result.direction).toBe('实时方向，继续')
  })

  it('extracts text from OpenAI SSE chunks', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
    const adapter = new HttpAiAdapter('/api')
    const chunks: string[] = []
    await adapter.generateEpisode({ episodeNumber: 1, outline: '大纲', targetWords: 1000, prompt: '写第一集' }, { onChunk: (chunk) => chunks.push(chunk) })
    expect(chunks).toEqual(['第一段', '第二段'])
  })

  it('normalizes object arrays in planning fields into readable text', async () => {
    const content = JSON.stringify({
      titleCandidates: ['标题'],
      genre: '悬疑',
      seriesOutline: '总纲',
      phasePlan: [{ phase: '起势', content: '主角收到遗嘱' }, { phase: '反击', content: '公开证据' }]
    })
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))
    const adapter = new HttpAiAdapter('/api')
    const result = await adapter.generateSeriesPlan({ adaptation: '设定', episodeCount: 12, targetWords: 1000, prompt: '生成规划' })
    expect(result.phasePlan).toContain('起势')
    expect(result.phasePlan).toContain('主角收到遗嘱')
    expect(result.phasePlan).not.toContain('[object Object]')
  })
})
