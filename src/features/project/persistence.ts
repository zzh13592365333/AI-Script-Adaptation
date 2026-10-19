import type { Project } from '@/domain/project'
import { normalizeProjectStructuredText } from '@/features/ai/normalize-output'

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface SaveResult { ok: boolean; savingPaused?: boolean; error?: string }
export interface ImportResult { ok: boolean; project: Project; error?: string }

const keyFor = (projectId: string) => `ai-comic-workflow.project.v1.${projectId}`

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<Project>
  return project.schemaVersion === 1 && typeof project.id === 'string' && typeof project.name === 'string'
    && !!project.planning && Array.isArray(project.outlines) && Array.isArray(project.scripts)
}

export function saveProject(project: Project, storage: StorageLike = localStorage): SaveResult {
  try {
    storage.setItem(keyFor(project.id), JSON.stringify(project))
    return { ok: true }
  } catch (error) {
    const quota = error instanceof DOMException && error.name === 'QuotaExceededError'
    return { ok: false, savingPaused: true, error: quota ? '本地存储空间不足' : '本地保存失败' }
  }
}

export function loadProject(projectId: string, storage: StorageLike = localStorage): Project | null {
  const raw = storage.getItem(keyFor(projectId))
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isProject(parsed) ? normalizeProjectStructuredText(parsed) : null
  } catch { return null }
}

export function importProject(raw: string, current: Project): ImportResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isProject(parsed)) return { ok: false, project: current, error: '项目文件版本不兼容或内容不完整' }
    return { ok: true, project: normalizeProjectStructuredText(parsed) }
  } catch { return { ok: false, project: current, error: '项目文件不是有效的 JSON' } }
}

export function createDebouncedSaver(delayMs = 300, storage: StorageLike = localStorage) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (project: Project, onResult?: (result: SaveResult) => void) => {
    clearTimeout(timer)
    timer = setTimeout(() => onResult?.(saveProject(project, storage)), delayMs)
  }
}
