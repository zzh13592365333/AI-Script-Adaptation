import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ScriptReviewPanel from '@/components/episodes/ScriptReviewPanel.vue'
import ScriptVersionHistory from '@/components/episodes/ScriptVersionHistory.vue'
import ScriptGenerationView from '@/views/ScriptGenerationView.vue'
import { MockAiAdapter } from '@/features/ai/mock-adapter'
import type { ScriptTaskClient } from '@/features/script-tasks/client'
import type { QualityCheckResult, ScriptTaskResponse, ScriptVersion } from '@/features/script-tasks/types'
import { useWorkflowStore } from '@/stores/workflow'

const passedQuality: QualityCheckResult = {
  passed: true,
  outline_consistency: true,
  character_consistency: true,
  continuity_consistency: true,
  format_compliance: true,
  translation_compliance: true,
  terminology_consistency: true,
  length_compliance: true,
  user_requirements_compliance: true,
  issues: [],
  revision_instructions: []
}

function backendTask(status: ScriptTaskResponse['status'], overrides: Partial<ScriptTaskResponse> = {}): ScriptTaskResponse {
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

function fakeClient(overrides: Partial<ScriptTaskClient> = {}): ScriptTaskClient {
  return {
    create: vi.fn().mockResolvedValue(backendTask('queued')),
    get: vi.fn().mockResolvedValue(backendTask('running')),
    result: vi.fn().mockResolvedValue(backendTask('completed')),
    versions: vi.fn().mockResolvedValue([] satisfies ScriptVersion[]),
    review: vi.fn().mockResolvedValue(backendTask('running')),
    regenerate: vi.fn().mockResolvedValue(backendTask('running')),
    cancel: vi.fn().mockResolvedValue(backendTask('cancelled')),
    waitForReview: vi.fn().mockResolvedValue(backendTask('awaiting_human_review')),
    ...overrides
  } as unknown as ScriptTaskClient
}

describe('script generation workflow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('streams one episode into the matching script', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.project.outlines[0].status = 'confirmed'
    store.project.outlines[0].content = 'Mia 找到信托副本'
    await store.generateEpisode(1)
    expect(store.project.scripts[0].status).toBe('ready')
    expect(store.project.scripts[0].content).toContain('第 1 集')
    expect(store.project.scripts[0].partial).toBe(false)
  })

  it('batch generation skips valid completed episodes', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.project.outlines[0].status = 'confirmed'
    store.project.outlines[1].status = 'confirmed'
    store.project.outlines[1].content = '第二集冲突'
    store.project.scripts[0].status = 'confirmed'
    store.project.scripts[0].content = '保留第一集'
    await store.generateBatch(1)
    expect(store.project.scripts[0].content).toBe('保留第一集')
    expect(store.project.scripts[1].content).toContain('第 2 集')
  })

  it('rewrites an existing episode using the instruction', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.project.outlines[0].status = 'confirmed'
    store.project.outlines[0].content = '第一集大纲'
    store.project.scripts[0].content = '旧正文'
    await store.rewriteEpisode(1, '加强结尾反转')
    expect(store.project.scripts[0].content).toContain('加强结尾反转')
    expect(store.project.scripts[0].status).toBe('ready')
  })

  it('confirms all scripts and blocks confirmation while one is generating', () => {
    const store = useWorkflowStore()
    store.project.scripts[0].content = '第一集剧本'
    store.project.scripts[0].status = 'ready'
    store.project.scripts[1].status = 'generating'
    expect(store.confirmAllScripts()).toBe(false)
    store.project.scripts[1].status = 'empty'
    expect(store.confirmAllScripts()).toBe(true)
    expect(store.project.scripts[0].status).toBe('confirmed')
    expect(store.project.scripts[1].status).toBe('empty')
  })

  it('advances to the next script after confirming one episode', () => {
    const store = useWorkflowStore()
    store.project.scripts[0].content = '第一集剧本'
    store.project.scripts[0].status = 'ready'
    expect(store.confirmScript(1)).toBe(2)
    expect(store.project.scripts[0].status).toBe('confirmed')
  })

  it('uses backend tasks and preserves the draft at human review', async () => {
    const updates = [backendTask('running', { current_stage: 'reviewing', progress: 65 })]
    const client = fakeClient({
      waitForReview: vi.fn(async (_taskId, options) => {
        updates.forEach((item) => options?.onUpdate?.(item))
        return backendTask('awaiting_human_review', {
          script_content: 'Backend draft',
          quality_check_result: passedQuality,
          retry_count: 1,
          version: 1
        })
      })
    })
    const store = useWorkflowStore()
    store.setScriptTaskClient(client)
    store.project.outlines[0].status = 'confirmed'
    store.project.outlines[0].content = 'Episode one outline'

    await store.generateEpisode(1)

    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      project_id: store.project.id,
      episode_number: 1,
      episode_outline: 'Episode one outline'
    }))
    expect(store.project.scripts[0]).toEqual(expect.objectContaining({
      content: 'Backend draft',
      status: 'ready',
      taskId: 'task-1',
      taskStatus: 'awaiting_human_review',
      taskStage: 'human_review',
      retryCount: 1,
      qualityCheck: passedQuality
    }))
  })

  it('accepts, edits, and requests revision through the backend review task', async () => {
    const waitForReview = vi.fn()
      .mockResolvedValueOnce(backendTask('completed', { script_content: 'Accepted draft', final_approved: true, version: 2 }))
      .mockResolvedValueOnce(backendTask('completed', { script_content: 'Edited final', final_approved: true, version: 3 }))
      .mockResolvedValueOnce(backendTask('awaiting_human_review', { script_content: 'Revised draft', quality_check_result: passedQuality, version: 4 }))
    const review = vi.fn().mockResolvedValue(backendTask('running'))
    const client = fakeClient({ review, waitForReview })
    const store = useWorkflowStore()
    store.setScriptTaskClient(client)
    Object.assign(store.project.scripts[0], { content: 'Draft', status: 'ready', taskId: 'task-1', taskStatus: 'awaiting_human_review' })

    await store.reviewScriptTask(1, { action: 'accept' })
    expect(store.project.scripts[0].status).toBe('confirmed')
    await store.reviewScriptTask(1, { action: 'edit_accept', edited_content: 'Edited final' })
    expect(store.project.scripts[0].content).toBe('Edited final')
    await store.reviewScriptTask(1, { action: 'request_revision', feedback: 'Increase tension' })
    expect(store.project.scripts[0]).toEqual(expect.objectContaining({ content: 'Revised draft', status: 'ready', taskStatus: 'awaiting_human_review' }))
    expect(review).toHaveBeenNthCalledWith(3, 'task-1', { action: 'request_revision', feedback: 'Increase tension' })
  })

  it('loads versions, cancels backend work, and exposes sanitized failures', async () => {
    const versions: ScriptVersion[] = [{
      task_id: 'task-1', version: 1, content: 'Draft v1', source: 'model', approved: false,
      idempotency_key: 'draft-1', created_at: '2026-10-20T00:00:00Z'
    }]
    const client = fakeClient({
      versions: vi.fn().mockResolvedValue(versions),
      create: vi.fn().mockRejectedValue(new Error('Backend unavailable'))
    })
    const store = useWorkflowStore()
    store.setScriptTaskClient(client)
    Object.assign(store.project.scripts[0], { content: 'Partial draft', status: 'generating', taskId: 'task-1' })

    await store.loadScriptVersions(1)
    expect(store.project.scripts[0].versions).toEqual(versions)
    await store.cancelScriptTask(1)
    expect(store.project.scripts[0].taskStatus).toBe('cancelled')

    store.project.outlines[1].content = 'Episode two'
    await store.generateEpisode(2)
    expect(store.project.scripts[1].status).toBe('error')
    expect(store.notice).toBe('Backend unavailable')
  })

  it('keeps the review draft and reports backend revision failure', async () => {
    const client = fakeClient({
      review: vi.fn().mockResolvedValue(backendTask('running')),
      waitForReview: vi.fn().mockResolvedValue(backendTask('model_failed', {
        current_stage: 'failed',
        script_content: 'Existing draft',
        error_code: 'model_timeout',
        error_message: '模型请求超时，请稍后重试'
      }))
    })
    const store = useWorkflowStore()
    store.setScriptTaskClient(client)
    Object.assign(store.project.scripts[0], {
      content: 'Existing draft', status: 'ready', taskId: 'task-1', taskStatus: 'awaiting_human_review'
    })

    await store.reviewScriptTask(1, { action: 'request_revision', feedback: 'Try once more' })

    expect(store.project.scripts[0]).toEqual(expect.objectContaining({
      content: 'Existing draft', status: 'ready', taskStatus: 'model_failed'
    }))
    expect(store.notice).toBe('模型请求超时，请稍后重试')
  })

  it('keeps legacy scripts editable when backend metadata is absent', () => {
    const store = useWorkflowStore()
    const legacyScript = store.project.scripts[0] as Record<string, unknown>
    expect(legacyScript.taskId).toBeUndefined()
    store.updateScript(1, 'Legacy edited script')
    expect(store.project.scripts[0].content).toBe('Legacy edited script')
  })

  it('does not bypass backend human review through local confirmation actions', () => {
    const store = useWorkflowStore()
    Object.assign(store.project.scripts[0], {
      content: 'Backend draft',
      status: 'ready',
      taskId: 'task-1',
      taskStatus: 'awaiting_human_review'
    })

    expect(store.confirmScript(1)).toBe(1)
    expect(store.confirmAllScripts()).toBe(false)
    expect(store.project.scripts[0].status).toBe('ready')
  })
})

describe('script review components', () => {
  it('shows running stage and disables approval until human review', () => {
    const wrapper = mount(ScriptReviewPanel, {
      props: {
        script: {
          episodeNumber: 1, content: 'Draft', status: 'generating', partial: false, summaryStale: false,
          taskId: 'task-1', taskStatus: 'running', taskStage: 'reviewing', taskProgress: 65, retryCount: 0, maxRetries: 2
        }
      }
    })
    expect(wrapper.text()).toContain('AI 质量审核')
    expect(wrapper.text()).toContain('65%')
    expect(wrapper.get('[data-test="accept-script"]').attributes('disabled')).toBeDefined()
  })

  it('shows quality issues and requires revision feedback', async () => {
    const wrapper = mount(ScriptReviewPanel, {
      props: {
        script: {
          episodeNumber: 1, content: 'Draft', status: 'ready', partial: false, summaryStale: false,
          taskId: 'task-1', taskStatus: 'awaiting_human_review', taskStage: 'human_review', taskProgress: 90,
          retryCount: 2, maxRetries: 2,
          qualityCheck: { ...passedQuality, passed: false, outline_consistency: false, issues: ['Outline mismatch'], revision_instructions: ['Repair the ending'] }
        }
      }
    })
    expect(wrapper.text()).toContain('Outline mismatch')
    expect(wrapper.get('[data-test="request-revision"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="review-feedback"]').setValue('Repair continuity')
    await wrapper.get('[data-test="request-revision"]').trigger('click')
    expect(wrapper.emitted('requestRevision')).toEqual([['Repair continuity']])
  })

  it('selects an immutable script version', async () => {
    const wrapper = mount(ScriptVersionHistory, {
      props: {
        versions: [{
          task_id: 'task-1', version: 1, content: 'Draft v1', source: 'model', approved: false,
          idempotency_key: 'draft-1', created_at: '2026-10-20T00:00:00Z'
        }],
        currentVersion: 2
      }
    })
    await wrapper.get('[data-test="version-1"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['Draft v1']])
  })

  it('keeps the mock stage-five view free of backend review controls', () => {
    const wrapper = mount(ScriptGenerationView, { global: { plugins: [createPinia()] } })
    expect(wrapper.find('[data-testid="script-review-panel"]').exists()).toBe(false)
    expect(wrapper.findAll('button').length).toBeGreaterThan(0)
  })
})
