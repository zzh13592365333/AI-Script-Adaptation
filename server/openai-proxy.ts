import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export interface OpenAiProxyConfig {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: string
}

interface OpenAiProxyInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  stream?: boolean
  temperature?: number
}

export function buildOpenAiRequest(input: OpenAiProxyInput, config: OpenAiProxyConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: {
      ...input,
      model: config.model,
      stream: input.stream ?? false,
      reasoning_effort: config.reasoningEffort ?? 'low'
    }
  }
}

function configurationError(config: OpenAiProxyConfig): string | null {
  if (!config.baseUrl) return '未配置 OPENAI_BASE_URL'
  if (!config.apiKey) return '未配置 OPENAI_API_KEY'
  if (!config.model) return '未配置 OPENAI_MODEL'
  return null
}

async function readJson(req: IncomingMessage): Promise<OpenAiProxyInput> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as OpenAiProxyInput
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function handleOpenAiRequest(req: IncomingMessage, res: ServerResponse, config: OpenAiProxyConfig) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '仅支持 POST 请求' })
    return
  }
  const missing = configurationError(config)
  if (missing) {
    sendJson(res, 503, { error: missing })
    return
  }

  try {
    const input = await readJson(req)
    const request = buildOpenAiRequest(input, config)
    const upstream = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10 * 60 * 1000)
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      sendJson(res, upstream.status, { error: `模型接口请求失败：${upstream.status}`, detail: detail.slice(0, 2000) })
      return
    }
    if (input.stream) {
      if (!upstream.body) {
        sendJson(res, 502, { error: '模型接口未返回流式响应' })
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      const reader = upstream.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
      return
    }

    const payload = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      sendJson(res, 502, { error: '模型接口响应中缺少文本内容' })
      return
    }
    sendJson(res, 200, { content })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    sendJson(res, 500, { error: `OpenAI 兼容接口调用失败：${message}` })
  }
}

export function openAiProxyPlugin(config: OpenAiProxyConfig): Plugin {
  const middleware = () => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname !== '/api/openai/chat') {
      next()
      return
    }
    void handleOpenAiRequest(req, res, config)
  }
  return {
    name: 'openai-compatible-proxy',
    configureServer(server) { server.middlewares.use(middleware()) },
    configurePreviewServer(server) { server.middlewares.use(middleware()) }
  }
}
