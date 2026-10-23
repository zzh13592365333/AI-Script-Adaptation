import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContextPanel from '@/components/layout/ContextPanel.vue'

describe('context panel model status', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => vi.unstubAllEnvs())

  it('shows the configured API model when the HTTP adapter is active', () => {
    vi.stubEnv('VITE_AI_ADAPTER', 'http')
    vi.stubEnv('VITE_MODEL_NAME', 'OpenAI Compatible')

    const wrapper = mount(ContextPanel, { global: { plugins: [createPinia()] } })

    expect(wrapper.text()).toContain('OpenAI Compatible')
    expect(wrapper.text()).toContain('接口生成模式')
    expect(wrapper.text()).toContain('API')
    expect(wrapper.text()).not.toContain('本地演示模式')
  })
})
