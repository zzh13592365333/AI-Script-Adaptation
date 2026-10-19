import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MockAiAdapter } from '@/features/ai/mock-adapter'
import { useWorkflowStore } from '@/stores/workflow'

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
})
