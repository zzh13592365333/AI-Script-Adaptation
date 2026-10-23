import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScriptTaskApiError, ScriptTaskClient } from '@/features/script-tasks/client'
import type { ScriptTaskCreate, ScriptTaskResponse } from '@/features/script-tasks/types'

const createPayload: ScriptTaskCreate = {
  project_id: 'project-1',
  episode_id: 'episode-1',
  episode_number: 1,
  episode_outline: 'Episode outline',
  character_context: 'Characters',
  world_context: 'World',
  previous_episode_summary: '',
  user_requirements: '',
  target_words: 1200,
  max_retries: 2
}

function task(status: ScriptTaskResponse['status'], overrides: Partial<ScriptTaskResponse> = {}): ScriptTaskResponse {
  return {
    task_id: 'task-1',
    project_id: 'project-1',
    episode_id: 'episode-1',
    episode_number: 1,
    status,
    current_stage: status === 'awaiting_human_review' ? 'human_review' : 'generating',
    progress: status === 'awaiting_human_review' ? 90 : 20,
    script_content: '',
    quality_check_result: null,
    retry_count: 0,
    max_retries: 2,
    final_approved: false,
    version: 0,
    error_code: null,
    error_message: null,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-20T00:00:00Z',
    ...overrides
  }
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  }))
}

describe('ScriptTaskClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the same-origin API path by default', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => response(task('running')))
    const client = new ScriptTaskClient()

    await client.get('task-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/script-tasks/task-1', expect.anything())
  })

  it('calls the native fetch function without rebinding its receiver', async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return response(task('running'))
    })
    vi.stubGlobal('fetch', nativeLikeFetch)
    const client = new ScriptTaskClient('/backend-api')

    await expect(client.get('task-1')).resolves.toMatchObject({ status: 'running' })
  })

  it('uses the backend task paths and JSON request bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response(task('queued'), 202))
      .mockImplementationOnce(() => response(task('running')))
      .mockImplementationOnce(() => response(task('completed')))
      .mockImplementationOnce(() => response([]))
      .mockImplementationOnce(() => response(task('running'), 202))
      .mockImplementationOnce(() => response(task('running'), 202))
      .mockImplementationOnce(() => response(task('cancelled'), 202))
    const client = new ScriptTaskClient('/backend-api')

    await client.create(createPayload)
    await client.get('task-1')
    await client.result('task-1')
    await client.versions('task-1')
    await client.review('task-1', { action: 'request_revision', feedback: 'More tension' })
    await client.regenerate('task-1', 'Try again')
    await client.cancel('task-1')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/backend-api/api/script-tasks',
      '/backend-api/api/script-tasks/task-1',
      '/backend-api/api/script-tasks/task-1/result',
      '/backend-api/api/script-tasks/task-1/versions',
      '/backend-api/api/script-tasks/task-1/review',
      '/backend-api/api/script-tasks/task-1/regenerate',
      '/backend-api/api/script-tasks/task-1/cancel'
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(createPayload)
    expect(JSON.parse(String(fetchMock.mock.calls[4][1]?.body))).toEqual({ action: 'request_revision', feedback: 'More tension' })
  })

  it('polls until human review and reports progress updates', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response(task('running')))
      .mockImplementationOnce(() => response(task('awaiting_human_review', { script_content: 'Draft' })))
    const updates: string[] = []
    const client = new ScriptTaskClient('/backend-api')

    const result = await client.waitForReview('task-1', {
      intervalMs: 1,
      timeoutMs: 100,
      onUpdate: (value) => updates.push(value.status)
    })

    expect(result.status).toBe('awaiting_human_review')
    expect(updates).toEqual(['running', 'awaiting_human_review'])
  })

  it('stops polling on abort and timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => response(task('running')))
    const client = new ScriptTaskClient('/backend-api')
    const controller = new AbortController()
    controller.abort()

    await expect(client.waitForReview('task-1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(client.waitForReview('task-1', { intervalMs: 1, timeoutMs: 2 })).rejects.toThrow('任务轮询超时')
  })

  it('exposes only sanitized API error details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => response({ detail: '模型服务调用失败', api_key: 'secret' }, 502))
    const client = new ScriptTaskClient('/backend-api')

    await expect(client.get('task-1')).rejects.toEqual(expect.objectContaining<Partial<ScriptTaskApiError>>({
      name: 'ScriptTaskApiError',
      status: 502,
      message: '模型服务调用失败'
    }))
  })
})
