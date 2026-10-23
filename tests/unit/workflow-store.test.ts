import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MockAiAdapter } from '@/features/ai/mock-adapter'
import type { SourceAnalysisResult, StreamCallbacks } from '@/features/ai/adapter'
import { useWorkflowStore } from '@/stores/workflow'
import type { StageReviewPayload, StageRevisionPayload } from '@/features/stage-reviews/types'

describe('workflow store stages one to three', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the sample and completes analysis, setup, and planning', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.setStageReviewClient({
      check: async () => ({ passed: true, issues: [], revision_instructions: [] }),
      revise: async ({ content }) => ({ content })
    })
    store.loadSample()
    expect(store.project.source?.type).toBe('sample')

    await store.analyzeSource()
    expect(store.project.analysis.status).toBe('ready')
    await store.checkStage('analysis')
    store.confirmAnalysis()
    await store.generateAdaptation()
    expect(store.project.adaptation.direction).toContain('竖屏漫剧')
    await store.checkStage('adaptation')
    store.confirmAdaptation()
    await store.generatePlan()
    expect(store.project.planning.titleCandidates).toHaveLength(3)
    await store.checkStage('planning')
    expect(store.project.planning.status).toBe('ready')
  })

  it('preserves setup edits and marks existing downstream content dirty', () => {
    const store = useWorkflowStore()
    store.project.adaptation.status = 'confirmed'
    store.project.planning.status = 'confirmed'
    store.updateAdaptation('direction', '改成英国市场')
    expect(store.project.adaptation.direction).toBe('改成英国市场')
    expect(store.project.adaptation.status).toBe('ready')
    expect(store.project.planning.status).toBe('dirty')
  })

  it('restores a persisted project', () => {
    const store = useWorkflowStore()
    const saved = JSON.parse(JSON.stringify(store.project))
    saved.name = '恢复项目'
    localStorage.setItem(`adaptation-workbench.project.v1.${saved.id}`, JSON.stringify(saved))
    expect(store.restore(saved.id)).toBe(true)
    expect(store.project.name).toBe('恢复项目')
  })

  it('sends the saved prompt override with the next analysis request', async () => {
    class CapturingAdapter extends MockAiAdapter {
      prompt = ''
      override async analyzeSource(input: { sourceText: string; prompt?: string }): Promise<SourceAnalysisResult> {
        this.prompt = input.prompt ?? ''
        return super.analyzeSource(input)
      }
    }
    localStorage.setItem('adaptation-workbench.prompts.v1', JSON.stringify({ sourceAnalysis: { userTemplate: '自定义分析：{{sourceText}}' } }))
    const adapter = new CapturingAdapter({ latencyMs: 1 })
    const store = useWorkflowStore()
    store.setAdapter(adapter)
    store.loadSample()
    await store.analyzeSource()
    expect(adapter.prompt).toContain('自定义分析：')
  })

  it('shows an actionable notice when analysis fails', async () => {
    class FailingAdapter extends MockAiAdapter {
      override async analyzeSource(): Promise<SourceAnalysisResult> { throw new Error('模型暂时不可用') }
    }
    const store = useWorkflowStore()
    store.setAdapter(new FailingAdapter())
    store.loadSample()
    await store.analyzeSource()
    expect(store.project.analysis.status).toBe('error')
    expect(store.notice).toContain('模型暂时不可用')
  })

  it('updates analysis content before the streaming request completes', async () => {
    let finish!: () => void
    class StreamingAdapter extends MockAiAdapter {
      override async analyzeSource(
        _input: { sourceText: string; prompt?: string },
        callbacks?: StreamCallbacks
      ): Promise<SourceAnalysisResult> {
        callbacks?.onChunk('实时分析第一段')
        await new Promise<void>((resolve) => { finish = resolve })
        callbacks?.onChunk('，第二段')
        return { content: '实时分析第一段，第二段' }
      }
    }
    const store = useWorkflowStore()
    store.setAdapter(new StreamingAdapter())
    store.loadSample()
    const analysis = store.analyzeSource()
    await Promise.resolve()
    expect(store.project.analysis.content).toBe('实时分析第一段')
    expect(store.project.analysis.status).toBe('generating')
    finish()
    await analysis
    expect(store.project.analysis.content).toBe('实时分析第一段，第二段')
    expect(store.project.analysis.status).toBe('ready')
  })

  it('moves to the next stage after each confirmation', () => {
    const store = useWorkflowStore()
    store.project.analysis.content = '分析'
    Object.assign(store.project.stageReviews.analysis, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    store.confirmAnalysis()
    expect(store.project.activeStage).toBe('adaptation')
    store.project.adaptation.direction = '方向'
    Object.assign(store.project.stageReviews.adaptation, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    store.confirmAdaptation()
    expect(store.project.activeStage).toBe('planning')
    store.project.planning.seriesOutline = '总纲'
    Object.assign(store.project.stageReviews.planning, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    store.confirmPlan()
    expect(store.project.activeStage).toBe('outlines')
    store.project.outlines[0].content = '第一集大纲'
    Object.assign(store.project.stageReviews.outlines, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    expect(store.confirmOutline(1)).toBe(2)
    expect(store.project.activeStage).toBe('outlines')
    const finalEpisode = store.project.outlines.length
    store.project.outlines[finalEpisode - 1].content = '最后一集大纲'
    store.confirmOutline(finalEpisode)
    expect(store.project.activeStage).toBe('scripts')
  })

  it('allows confirming the current analysis version without an AI check', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.loadSample()
    await store.analyzeSource()

    store.confirmAnalysis()
    expect(store.project.activeStage).toBe('adaptation')
    expect(store.project.analysis.status).toBe('confirmed')
  })

  it('creates a new unchecked version after an AI revision', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.setStageReviewClient({
      check: async () => ({ passed: false, issues: ['冲突不够强'], revision_instructions: ['强化限时目标'] }),
      revise: async () => ({ content: { content: '修订后的分析' } })
    })
    store.loadSample()
    await store.analyzeSource()
    await store.checkStage('analysis')
    await store.reviseStage('analysis', '保留人物关系')

    expect(store.project.analysis.content).toBe('修订后的分析')
    expect(store.project.stageReviews.analysis.currentVersion).toBe(2)
    expect(store.project.stageReviews.analysis.status).toBe('idle')
  })

  it('does not generate a downstream stage before its upstream stage is confirmed', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.loadSample()
    await store.analyzeSource()

    await store.generateAdaptation()

    expect(store.project.adaptation.status).toBe('empty')
    expect(store.notice).toContain('请先确认原稿分析')
  })
})
