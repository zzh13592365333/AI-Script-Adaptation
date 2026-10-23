import type {
  PollOptions,
  ReviewRequest,
  ScriptTaskCreate,
  ScriptTaskResponse,
  ScriptVersion
} from './types'

const terminalStatuses = new Set<ScriptTaskResponse['status']>([
  'awaiting_human_review',
  'completed',
  'model_failed',
  'validation_failed',
  'cancelled'
])

export class ScriptTaskApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ScriptTaskApiError'
  }
}

export class ScriptTaskClient {
  private readonly root: string

  constructor(baseUrl = '', private readonly fetcher: typeof fetch = fetch) {
    this.root = `${baseUrl.replace(/\/$/, '')}/api/script-tasks`
  }

  create(payload: ScriptTaskCreate) {
    return this.request<ScriptTaskResponse>('', { method: 'POST', body: JSON.stringify(payload) })
  }

  get(taskId: string) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}`)
  }

  result(taskId: string) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}/result`)
  }

  versions(taskId: string) {
    return this.request<ScriptVersion[]>(`/${encodeURIComponent(taskId)}/versions`)
  }

  review(taskId: string, payload: ReviewRequest) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}/review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  regenerate(taskId: string, feedback: string) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ feedback })
    })
  }

  cancel(taskId: string) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
  }

  async waitForReview(taskId: string, options: PollOptions = {}): Promise<ScriptTaskResponse> {
    const intervalMs = options.intervalMs ?? 750
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
    const startedAt = Date.now()
    while (true) {
      throwIfAborted(options.signal)
      const task = await this.getWithSignal(taskId, options.signal)
      options.onUpdate?.(task)
      if (terminalStatuses.has(task.status)) return task
      if (Date.now() - startedAt >= timeoutMs) throw new Error('任务轮询超时')
      await delay(intervalMs, options.signal)
    }
  }

  private getWithSignal(taskId: string, signal?: AbortSignal) {
    return this.request<ScriptTaskResponse>(`/${encodeURIComponent(taskId)}`, { signal })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body) headers.set('Content-Type', 'application/json')
    const response = await this.fetcher.call(globalThis, `${this.root}${path}`, { ...init, headers })
    if (!response.ok) {
      const message = await readErrorDetail(response)
      throw new ScriptTaskApiError(message, response.status)
    }
    return response.json() as Promise<T>
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: unknown }
    return typeof body.detail === 'string' ? body.detail : `请求失败 (${response.status})`
  } catch {
    return `请求失败 (${response.status})`
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted', 'AbortError'))
    }, { once: true })
  })
}
