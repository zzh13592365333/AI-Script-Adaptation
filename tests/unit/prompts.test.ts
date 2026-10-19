import { describe, expect, it } from 'vitest'
import { promptTemplates } from '@/features/prompts/templates'
import { renderPrompt } from '@/features/prompts/render'

describe('prompt templates', () => {
  it('provides six versioned prompt templates', () => {
    expect(Object.keys(promptTemplates)).toEqual([
      'sourceAnalysis', 'adaptationSetup', 'seriesPlanning',
      'episodeOutlines', 'episodeExpansion', 'episodeRewrite'
    ])
    Object.values(promptTemplates).forEach((template) => expect(template.version).toMatch(/^1\./))
  })

  it('renders every declared variable', () => {
    const result = renderPrompt('标题：{{title}}，集数：{{count}}', { title: '逆光', count: 24 })
    expect(result).toBe('标题：逆光，集数：24')
  })

  it('rejects a missing variable instead of sending an incomplete prompt', () => {
    expect(() => renderPrompt('{{title}} / {{genre}}', { title: '逆光' })).toThrow('genre')
  })
})
