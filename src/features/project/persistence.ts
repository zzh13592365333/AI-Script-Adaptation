import { createStageReviews, type Project } from '@/domain/project'
import { normalizeProjectStructuredText } from '@/features/ai/normalize-output'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
  readonly length?: number
  key?(index: number): string | null
}
export interface SaveResult { ok: boolean; savingPaused?: boolean; error?: string }
export interface ImportResult { ok: boolean; project: Project; error?: string }
export interface ProjectSummary { id: string; name: string; updatedAt: string; activeStage: Project['activeStage']; episodeCount: number }

const keyFor = (projectId: string) => `ai-comic-workflow.project.v1.${projectId}`
const legacyKeysFor = (projectId: string) => [
  `adaptation-workbench.project.v1.${projectId}`
]

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<Project>
  return project.schemaVersion === 1 && typeof project.id === 'string' && typeof project.name === 'string'
    && !!project.planning && Array.isArray(project.outlines) && Array.isArray(project.scripts)
}

function migrateProject(project: Project): Project {
  const defaults = createStageReviews()
  const existing = project.stageReviews ?? ({} as Project['stageReviews'])
  project.stageReviews = {
    analysis: { ...defaults.analysis, ...existing.analysis, versions: existing.analysis?.versions ?? [] },
    adaptation: { ...defaults.adaptation, ...existing.adaptation, versions: existing.adaptation?.versions ?? [] },
    planning: { ...defaults.planning, ...existing.planning, versions: existing.planning?.versions ?? [] },
    outlines: { ...defaults.outlines, ...existing.outlines, versions: existing.outlines?.versions ?? [] }
  }
  return project
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

export function listProjects(storage: StorageLike = localStorage): ProjectSummary[] {
  const projects: ProjectSummary[] = []
  if (!storage.key || typeof storage.length !== 'number') return projects
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith('ai-comic-workflow.project.v1.')) continue
    const projectId = key.slice('ai-comic-workflow.project.v1.'.length)
    const project = loadProject(projectId, storage)
    if (project) projects.push({ id: project.id, name: project.name, updatedAt: project.updatedAt, activeStage: project.activeStage, episodeCount: project.planning.episodeCount })
  }
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function deleteProject(projectId: string, storage: StorageLike = localStorage): SaveResult {
  try {
    storage.removeItem?.(keyFor(projectId))
    legacyKeysFor(projectId).forEach((key) => storage.removeItem?.(key))
    return { ok: true }
  } catch { return { ok: false, error: '项目删除失败' } }
}

export function loadProject(projectId: string, storage: StorageLike = localStorage): Project | null {
  const raw = storage.getItem(keyFor(projectId)) ?? legacyKeysFor(projectId).map((key) => storage.getItem(key)).find(Boolean) ?? null
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isProject(parsed) ? migrateProject(normalizeProjectStructuredText(parsed)) : null
  } catch { return null }
}

export function importProject(raw: string, current: Project): ImportResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isProject(parsed)) return { ok: false, project: current, error: '项目文件版本不兼容或内容不完整' }
    return { ok: true, project: migrateProject(normalizeProjectStructuredText(parsed)) }
  } catch { return { ok: false, project: current, error: '项目文件不是有效的 JSON' } }
}

export function createDebouncedSaver(delayMs = 300, storage: StorageLike = localStorage) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (project: Project, onResult?: (result: SaveResult) => void) => {
    clearTimeout(timer)
    timer = setTimeout(() => onResult?.(saveProject(project, storage)), delayMs)
  }
}
