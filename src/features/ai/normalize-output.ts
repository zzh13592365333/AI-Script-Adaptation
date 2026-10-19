import type { AdaptationResult, SeriesPlanResult } from './adapter'
import type { Project } from '@/domain/project'

const keyLabels: Record<string, string> = {
  phase: '阶段', content: '内容', title: '标题', goal: '目标', conflict: '冲突',
  turn: '反转', hook: '悬念', episodes: '集数', description: '说明', name: '名称'
}

export function toReadableText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const text = toReadableText(item)
      return item && typeof item === 'object' ? `${index + 1}. ${text}` : text
    }).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${keyLabels[key] ?? key}：${toReadableText(item)}`)
      .join('；')
  }
  return String(value)
}

export function normalizeAdaptationResult(value: unknown): AdaptationResult {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    direction: toReadableText(result.direction),
    identity: toReadableText(result.identity),
    world: toReadableText(result.world),
    characters: toReadableText(result.characters)
  }
}

export function normalizeSeriesPlanResult(value: unknown): SeriesPlanResult {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const candidates = Array.isArray(result.titleCandidates)
    ? result.titleCandidates.map(toReadableText).filter(Boolean)
    : [toReadableText(result.titleCandidates)].filter(Boolean)
  return {
    titleCandidates: candidates,
    genre: toReadableText(result.genre),
    seriesOutline: toReadableText(result.seriesOutline),
    phasePlan: toReadableText(result.phasePlan)
  }
}

export function normalizeProjectStructuredText(project: Project): Project {
  Object.assign(project.adaptation, normalizeAdaptationResult(project.adaptation))
  const planning = normalizeSeriesPlanResult(project.planning)
  Object.assign(project.planning, planning)
  project.planning.title = toReadableText(project.planning.title)
  return project
}
