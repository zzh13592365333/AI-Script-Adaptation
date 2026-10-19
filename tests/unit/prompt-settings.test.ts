import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PromptSettingsDrawer from '@/components/settings/PromptSettingsDrawer.vue'

describe('prompt settings drawer', () => {
  beforeEach(() => localStorage.clear())

  it('edits and persists prompt templates', async () => {
    const wrapper = mount(PromptSettingsDrawer, { props: { open: true } })
    const editor = wrapper.get('[data-test="user-template"]')
    await editor.setValue('自定义提示词 {{sourceText}}')
    await wrapper.get('[data-test="save-prompts"]').trigger('click')
    const saved = JSON.parse(localStorage.getItem('ai-comic-workflow.prompts.v1') ?? '{}')
    expect(saved.sourceAnalysis.userTemplate).toBe('自定义提示词 {{sourceText}}')
  })

  it('restores defaults and clears persisted overrides', async () => {
    localStorage.setItem('ai-comic-workflow.prompts.v1', JSON.stringify({ sourceAnalysis: { userTemplate: '坏模板' } }))
    const wrapper = mount(PromptSettingsDrawer, { props: { open: true } })
    await wrapper.get('[data-test="restore-prompts"]').trigger('click')
    expect(localStorage.getItem('ai-comic-workflow.prompts.v1')).toBeNull()
    expect((wrapper.get('[data-test="user-template"]').element as HTMLTextAreaElement).value).toContain('{{sourceText}}')
  })
})
