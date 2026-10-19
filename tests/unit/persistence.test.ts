import { describe, expect, it } from 'vitest'
import { createProject } from '@/domain/project'
import { importProject, loadProject, saveProject } from '@/features/project/persistence'

describe('project persistence', () => {
  it('round-trips a valid project', () => {
    const project = createProject()
    project.name = '测试项目'
    const storage = new Map<string, string>()
    const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
    expect(saveProject(project, api).ok).toBe(true)
    expect(loadProject(project.id, api)?.name).toBe('测试项目')
  })

  it('rejects malformed import without changing the current project', () => {
    const current = createProject()
    const result = importProject('{"schemaVersion":99}', current)
    expect(result.ok).toBe(false)
    expect(result.project).toBe(current)
  })

  it('reports quota failure without throwing', () => {
    const storage = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    const result = saveProject(createProject(), storage)
    expect(result).toEqual({ ok: false, savingPaused: true, error: '本地存储空间不足' })
  })

  it('normalizes structured planning fields from saved projects', () => {
    const project = createProject()
    ;(project.planning as unknown as { phasePlan: unknown }).phasePlan = [{ phase: '起势', content: '遗嘱出现' }]
    const storage = new Map<string, string>([[`ai-comic-workflow.project.v1.${project.id}`, JSON.stringify(project)]])
    const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
    const loaded = loadProject(project.id, api)
    expect(loaded?.planning.phasePlan).toContain('遗嘱出现')
    expect(loaded?.planning.phasePlan).not.toContain('[object Object]')
  })
})
