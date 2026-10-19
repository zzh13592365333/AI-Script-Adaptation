import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MockAiAdapter } from '@/features/ai/mock-adapter'
import type { SourceAnalysisResult, StreamCallbacks } from '@/features/ai/adapter'
import { useWorkflowStore } from '@/stores/workflow'

describe('workflow store stages one to three', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the sample and completes analysis, setup, and planning', async () => {
    const store = useWorkflowStore()
    store.setAdapter(new MockAiAdapter({ latencyMs: 1 }))
    store.loadSample()
    expect(store.project.source?.type).toBe('sample')

    await store.analyzeSource()
    expect(store.project.analysis.status).toBe('ready')
    store.confirmAnalysis()
    await store.generateAdaptation()
    expect(store.project.adaptation.direction).toContain('竖屏漫剧')
    store.confirmAdaptation()
    await store.generatePlan()
    expect(store.project.planning.titleCandidates).toHaveLength(3)
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
    localStorage.setItem(`ai-comic-workflow.project.v1.${saved.id}`, JSON.stringify(saved))
    expect(store.restore(saved.id)).toBe(true)
    expect(store.project.name).toBe('恢复项目')
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
    store.confirmAnalysis()
    expect(store.project.activeStage).toBe('adaptation')
    store.project.adaptation.direction = '方向'
    store.confirmAdaptation()
    expect(store.project.activeStage).toBe('planning')
    store.project.planning.seriesOutline = '总纲'
    store.confirmPlan()
    expect(store.project.activeStage).toBe('outlines')
    store.project.outlines[0].content = '第一集大纲'
    expect(store.confirmOutline(1)).toBe(2)
    expect(store.project.activeStage).toBe('outlines')
    const finalEpisode = store.project.outlines.length
    store.project.outlines[finalEpisode - 1].content = '最后一集大纲'
    store.confirmOutline(finalEpisode)
    expect(store.project.activeStage).toBe('scripts')
  })
})
