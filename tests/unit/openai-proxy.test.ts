import { describe, expect, it } from 'vitest'
import { buildOpenAiRequest } from '../../server/openai-proxy'

describe('OpenAI proxy request builder', () => {
  it('keeps credentials server-side and injects the configured model', () => {
    const request = buildOpenAiRequest(
      { messages: [{ role: 'user', content: '你好' }], stream: true },
      { baseUrl: 'https://provider.example/v1', apiKey: 'secret', model: 'comic-model' }
    )
    expect(request.url).toBe('https://provider.example/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer secret')
    expect(request.body.model).toBe('comic-model')
    expect(request.body.stream).toBe(true)
    expect(request.body.reasoning_effort).toBe('low')
  })
})
