import type { StageReviewApi, StageReviewPayload, StageReviewResult, StageRevisionPayload, StageRevisionResult } from './types'

export class StageReviewClient implements StageReviewApi {
  private readonly root: string

  constructor(baseUrl = '', private readonly fetcher: typeof fetch = fetch) {
    this.root = `${baseUrl.replace(/\/$/, '')}/api/stage-reviews`
  }

  check(payload: StageReviewPayload) { return this.request<StageReviewResult>('/check', payload) }
  revise(payload: StageRevisionPayload) { return this.request<StageRevisionResult>('/revise', payload) }

  private async request<T>(path: string, payload: unknown): Promise<T> {
    const response = await this.fetcher.call(globalThis, `${this.root}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail ?? `阶段审核请求失败 (${response.status})`)
    }
    return response.json() as Promise<T>
  }
}
