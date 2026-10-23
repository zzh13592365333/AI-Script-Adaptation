import { describe, expect, it } from 'vitest'
import { createProject } from '@/domain/project'
import { deleteProject, importProject, listProjects, loadProject, saveProject } from '@/features/project/persistence'

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

  it('reads legacy project storage while writing the neutral key', () => {
    const project = createProject()
    const storage = new Map<string, string>()
    storage.set(`adaptation-workbench.project.v1.${project.id}`, JSON.stringify(project))
    const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
    expect(loadProject(project.id, api)?.id).toBe(project.id)
    saveProject(project, api)
    expect(storage.has(`ai-comic-workflow.project.v1.${project.id}`)).toBe(true)
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

  it('migrates projects that predate stage review metadata', () => {
    const project = createProject()
    const legacy = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
    delete legacy.stageReviews
    const storage = new Map<string, string>([[`ai-comic-workflow.project.v1.${project.id}`, JSON.stringify(legacy)]])
    const api = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }

    const loaded = loadProject(project.id, api)

    expect(loaded?.stageReviews.analysis.status).toBe('idle')
    expect(loaded?.stageReviews.outlines.versions).toEqual([])
  })

  it('lists saved projects with newest updates first and deletes one project', () => {
    const older = createProject()
    older.name = '旧项目'
    older.updatedAt = '2026-01-01T00:00:00.000Z'
    const newer = createProject()
    newer.name = '新项目'
    newer.updatedAt = '2026-01-02T00:00:00.000Z'
    const storage = new Map<string, string>()
    const api = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
      get length() { return storage.size },
      key: (index: number) => [...storage.keys()][index] ?? null
    }
    saveProject(older, api)
    saveProject(newer, api)

    expect(listProjects(api).map((item) => item.name)).toEqual(['新项目', '旧项目'])
    expect(deleteProject(newer.id, api).ok).toBe(true)
    expect(listProjects(api).map((item) => item.name)).toEqual(['旧项目'])
  })
})
