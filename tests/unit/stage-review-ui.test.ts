import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createStageReviewState } from '@/domain/project'
import StageReviewPanel from '@/components/review/StageReviewPanel.vue'

describe('stage review panel', () => {
  it('offers AI check and manual review as separate actions', async () => {
    const state = createStageReviewState()
    state.currentVersion = 1
    state.status = 'issues_found'
    state.issues = ['人物目标不清晰']
    state.revisionInstructions = ['增加限时目标']
    state.versions = [{ version: 1, content: { content: '分析' }, source: 'model', confirmed: false, createdAt: new Date().toISOString() }]
    const wrapper = mount(StageReviewPanel, { props: { state, confirmLabel: '确认分析', canConfirm: false } })

    expect(wrapper.text()).toContain('AI 自查')
    expect(wrapper.text()).toContain('人工审查')
    expect(wrapper.text()).toContain('人物目标不清晰')
    await wrapper.get('[data-test="ai-check"]').trigger('click')
    expect(wrapper.emitted('check')).toHaveLength(1)

    await wrapper.get('[data-test="manual-review"]').trigger('click')
    await wrapper.get('[data-test="manual-feedback"]').setValue('强化前三集钩子')
    await wrapper.get('[data-test="manual-revise"]').trigger('click')
    expect(wrapper.emitted('revise')?.[0]).toEqual(['强化前三集钩子'])
  })

  it('only enables confirmation after the current version passes', () => {
    const state = createStageReviewState()
    state.currentVersion = 2
    state.checkedVersion = 2
    state.status = 'passed'
    const wrapper = mount(StageReviewPanel, { props: { state, confirmLabel: '确认并进入下一阶段', canConfirm: true } })
    expect(wrapper.get('[data-test="confirm-stage"]').attributes('disabled')).toBeUndefined()
  })

  it('describes AI review as optional', () => {
    const state = createStageReviewState()
    state.currentVersion = 1
    const wrapper = mount(StageReviewPanel, { props: { state, confirmLabel: '确认并进入下一阶段', canConfirm: true } })

    expect(wrapper.text()).toContain('AI 自查为可选')
    expect(wrapper.text()).not.toContain('只有当前版本通过 AI 自查后')
  })
})
