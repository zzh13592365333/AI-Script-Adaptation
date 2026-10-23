import { describe, expect, it } from 'vitest'
import { createProject } from '@/domain/project'
import { aggregateNodeStatuses, canConfirmStage, canGenerate, markDirty, markStageChecked, recordStageVersion, resizeEpisodes } from '@/domain/workflow'

describe('workflow domain', () => {
  it('creates the exact project defaults', () => {
    const project = createProject()
    expect(project.schemaVersion).toBe(1)
    expect(project.planning.episodeCount).toBe(24)
    expect(project.planning.targetWords).toBe(1200)
    expect(project.analysis.status).toBe('empty')
    expect(project.outlines).toHaveLength(24)
    expect(project.scripts).toHaveLength(24)
    expect(project.stageReviews.analysis.status).toBe('idle')
  })

  it('allows confirmation without requiring an AI check', () => {
    let project = recordStageVersion(createProject(), 'analysis', { content: '第一版分析' }, 'model')
    expect(canConfirmStage(project, 'analysis').allowed).toBe(true)

    project = markStageChecked(project, 'analysis', true, [], [])
    expect(canConfirmStage(project, 'analysis').allowed).toBe(true)

    project = recordStageVersion(project, 'analysis', { content: '第二版分析' }, 'human')
    expect(project.stageReviews.analysis.versions).toHaveLength(2)
    expect(canConfirmStage(project, 'analysis').allowed).toBe(true)
  })

  it('invalidates downstream review gates without deleting their versions', () => {
    let project = recordStageVersion(createProject(), 'planning', { seriesOutline: '旧规划' }, 'model')
    project = markStageChecked(project, 'planning', true, [], [])
    project.planning.status = 'confirmed'

    const next = markDirty(project, { type: 'adaptation' })

    expect(next.stageReviews.planning.status).toBe('idle')
    expect(next.stageReviews.planning.versions).toHaveLength(1)
    expect(next.planning.status).toBe('dirty')
  })

  it('marks all populated downstream nodes dirty after a source change', () => {
    const project = createProject()
    project.analysis = { status: 'confirmed', content: 'analysis' }
    project.adaptation.status = 'confirmed'
    project.planning.status = 'confirmed'
    project.outlines[0].status = 'confirmed'
    project.scripts[0].status = 'confirmed'

    const next = markDirty(project, { type: 'source' })

    expect(next.analysis.status).toBe('dirty')
    expect(next.adaptation.status).toBe('dirty')
    expect(next.planning.status).toBe('dirty')
    expect(next.outlines[0].status).toBe('dirty')
    expect(next.scripts[0].status).toBe('dirty')
    expect(project.analysis.status).toBe('confirmed')
  })

  it('dirties only the affected script chain after an outline edit', () => {
    const project = createProject()
    project.scripts.forEach((script) => { script.status = 'confirmed' })
    const next = markDirty(project, { type: 'outline', episodeNumber: 3 })
    expect(next.scripts[1].status).toBe('confirmed')
    expect(next.scripts[2].status).toBe('dirty')
    expect(next.scripts[23].status).toBe('dirty')
  })

  it('enforces generation prerequisites', () => {
    const project = createProject()
    expect(canGenerate(project, 'adaptation').allowed).toBe(false)
    project.analysis = { status: 'confirmed', content: 'analysis' }
    expect(canGenerate(project, 'adaptation').allowed).toBe(true)
    expect(canGenerate(project, 'planning').allowed).toBe(false)
    project.adaptation.status = 'confirmed'
    expect(canGenerate(project, 'planning').allowed).toBe(true)
  })

  it('supports one to one hundred episodes', () => {
    const project = createProject()
    expect(resizeEpisodes(project, 1).outlines).toHaveLength(1)
    expect(() => resizeEpisodes(project, 0)).toThrow('1')
    expect(() => resizeEpisodes(project, 101)).toThrow('100')
  })

  it('reports a stage confirmed when every generated item is confirmed', () => {
    expect(aggregateNodeStatuses([{ status: 'confirmed' }, { status: 'empty' }])).toBe('confirmed')
    expect(aggregateNodeStatuses([{ status: 'confirmed' }, { status: 'ready' }])).toBe('ready')
    expect(aggregateNodeStatuses([{ status: 'confirmed' }, { status: 'generating' }])).toBe('generating')
  })

  it('recovers overflow episodes when count is restored', () => {
    const project = createProject()
    project.outlines[10].title = '保留的第十一集'
    project.scripts[10].content = '已生成内容'
    const reduced = resizeEpisodes(project, 8)
    expect(reduced.outlines).toHaveLength(8)
    expect(reduced.overflow.outlines).toHaveLength(16)

    const restored = resizeEpisodes(reduced, 12)
    expect(restored.outlines[10].title).toBe('保留的第十一集')
    expect(restored.scripts[10].content).toBe('已生成内容')
  })
})
