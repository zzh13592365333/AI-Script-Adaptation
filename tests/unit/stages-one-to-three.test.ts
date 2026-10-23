import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StageNavigation from '@/components/layout/StageNavigation.vue'
import SourceAnalysisView from '@/views/SourceAnalysisView.vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import { useWorkflowStore } from '@/stores/workflow'

describe('workbench stages one to three', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders all five workflow stages and changes the active stage', async () => {
    const wrapper = mount(StageNavigation, { global: { plugins: [createPinia()] } })
    expect(wrapper.text()).toContain('导入与分析')
    expect(wrapper.text()).toContain('漫剧脚本')
    await wrapper.get('[data-stage="planning"]').trigger('click')
    expect(useWorkflowStore().project.activeStage).toBe('planning')
  })

  it('loads the built-in manuscript from the source view', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SourceAnalysisView, { global: { plugins: [pinia] } })
    await wrapper.get('[data-test="load-sample"]').trigger('click')
    expect(useWorkflowStore().project.source?.name).toContain('示例')
    expect(wrapper.text()).toContain('雨夜来电')
  })

  it('uses neutral workbench branding', () => {
    const wrapper = mount(AppToolbar, { global: { plugins: [createPinia()] } })
    expect(wrapper.text()).toContain('自动AI漫剧流程')
    expect(wrapper.text()).not.toMatch(/海外短剧/i)
  })

  it('shows confirmed for a stage when all generated items are confirmed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkflowStore()
    store.project.scripts[0].content = '第一集剧本'
    store.project.scripts[0].status = 'confirmed'
    const wrapper = mount(StageNavigation, { global: { plugins: [pinia] } })
    expect(wrapper.get('[data-stage="scripts"]').text()).toContain('已确认')
  })
})
