import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MockAiAdapter } from '@/features/ai/mock-adapter'
import type { OutlineJobStatus } from '@/features/ai/adapter'
import { useWorkflowStore } from '@/stores/workflow'

describe('episode outline workflow', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('polls to completion without overwriting locked outlines', async () => {
    class OverwritingAdapter extends MockAiAdapter {
      override async getJob(jobId: string): Promise<OutlineJobStatus> {
        const result = await super.getJob(jobId)
        if (result.status === 'completed' && result.outlines) result.outlines[0] = { ...result.outlines[0], title: '服务端覆盖', content: '服务端覆盖' }
        return result
      }
    }
    const store = useWorkflowStore()
    store.setAdapter(new OverwritingAdapter({ latencyMs: 1 }))
    store.project.planning.status = 'confirmed'
    store.project.outlines[0] = { ...store.project.outlines[0], title: '人工标题', content: '人工内容', locked: true, status: 'confirmed' }
    await store.generateOutlines()
    expect(store.progress).toBe(100)
    expect(store.project.outlines[0].content).toBe('人工内容')
    expect(store.project.outlines[1].status).toBe('ready')
  })

  it('marks the corresponding and later scripts dirty after editing one outline', () => {
    const store = useWorkflowStore()
    store.project.scripts.forEach((script) => { script.status = 'confirmed' })
    store.updateOutline(3, '新标题', '新的第三集内容')
    expect(store.project.scripts[1].status).toBe('confirmed')
    expect(store.project.scripts[2].status).toBe('dirty')
    expect(store.project.outlines[2].status).toBe('ready')
  })

  it('shows completed outlines before the generation request finishes', async () => {
    let finish!: () => void
    class StreamingOutlinesAdapter extends MockAiAdapter {
      override async createOutlineJob(input: Parameters<MockAiAdapter['createOutlineJob']>[0], onOutline?: Parameters<MockAiAdapter['createOutlineJob']>[1]) {
        onOutline?.({ episodeNumber: 1, title: '实时第一集', content: '第一集内容', status: 'ready', locked: false }, 50)
        await new Promise<void>((resolve) => { finish = resolve })
        return super.createOutlineJob(input)
      }
    }
    const store = useWorkflowStore()
    store.setAdapter(new StreamingOutlinesAdapter({ latencyMs: 1 }))
    store.project.planning.seriesOutline = '总纲'
    store.project.planning.status = 'confirmed'
    const generation = store.generateOutlines()
    await Promise.resolve()
    expect(store.project.outlines[0].title).toBe('实时第一集')
    expect(store.progress).toBe(50)
    finish()
    await generation
  })

  it('advances by episode and enters scripts only after the final outline', () => {
    const store = useWorkflowStore()
    store.project.activeStage = 'outlines'
    store.project.outlines.forEach((outline) => { outline.content = `第 ${outline.episodeNumber} 集`; outline.status = 'ready' })
    Object.assign(store.project.stageReviews.outlines, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    expect(store.confirmOutline(1)).toBe(2)
    expect(store.project.activeStage).toBe('outlines')
    expect(store.confirmOutline(store.project.outlines.length)).toBe(store.project.outlines.length)
    expect(store.project.activeStage).toBe('scripts')
  })

  it('confirms all outlines at once but refuses while generation is active', () => {
    const store = useWorkflowStore()
    store.project.outlines.forEach((outline) => { outline.content = `第 ${outline.episodeNumber} 集`; outline.status = 'ready' })
    Object.assign(store.project.stageReviews.outlines, { status: 'passed', currentVersion: 1, checkedVersion: 1 })
    store.busyAction = 'outlines'
    expect(store.confirmAllOutlines()).toBe(false)
    expect(store.project.outlines[0].status).toBe('ready')
    store.busyAction = null
    expect(store.confirmAllOutlines()).toBe(true)
    expect(store.project.outlines.every((outline) => outline.status === 'confirmed')).toBe(true)
    expect(store.project.activeStage).toBe('scripts')
  })
})
