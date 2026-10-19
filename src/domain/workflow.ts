import { createOutline, createScript, type NodeStatus, type Project, type StageId } from './project'

export type DirtySource =
  | { type: 'source' | 'analysis' | 'adaptation' | 'planning' }
  | { type: 'outline' | 'script'; episodeNumber: number }

export interface GateResult { allowed: boolean; reason?: string }

export function aggregateNodeStatuses(items: Array<{ status: NodeStatus }>): NodeStatus {
  const generated = items.filter((item) => item.status !== 'empty')
  if (!generated.length) return 'empty'
  if (generated.some((item) => item.status === 'generating')) return 'generating'
  if (generated.some((item) => item.status === 'error')) return 'error'
  if (generated.some((item) => item.status === 'dirty')) return 'dirty'
  if (generated.every((item) => item.status === 'confirmed')) return 'confirmed'
  return 'ready'
}

function dirty(status: NodeStatus): NodeStatus {
  return status === 'empty' ? 'empty' : 'dirty'
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project
}

export function markDirty(project: Project, source: DirtySource): Project {
  const next = cloneProject(project)
  next.updatedAt = new Date().toISOString()

  if (source.type === 'source' || source.type === 'analysis') {
    next.analysis.status = dirty(next.analysis.status)
    next.adaptation.status = dirty(next.adaptation.status)
    next.planning.status = dirty(next.planning.status)
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'adaptation') {
    next.planning.status = dirty(next.planning.status)
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'planning') {
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'outline') {
    next.scripts.slice(source.episodeNumber - 1).forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'script') {
    const following = next.scripts[source.episodeNumber]
    if (following) following.summaryStale = true
  }
  return next
}

export function canGenerate(project: Project, stage: Exclude<StageId, 'source'>): GateResult {
  const gates = {
    adaptation: project.analysis.status === 'confirmed',
    planning: project.adaptation.status === 'confirmed',
    outlines: project.planning.status === 'confirmed',
    scripts: project.outlines.some((item) => item.status === 'confirmed')
  }
  const reasons = {
    adaptation: '请先确认原稿分析',
    planning: '请先确认漫剧设定',
    outlines: '请先确认全剧规划',
    scripts: '请至少确认一集分集大纲'
  }
  return gates[stage] ? { allowed: true } : { allowed: false, reason: reasons[stage] }
}

export function resizeEpisodes(project: Project, count: number): Project {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RangeError('总集数必须在 1 到 100 之间')
  }
  const next = cloneProject(project)
  const current = next.planning.episodeCount
  if (count < current) {
    next.overflow.outlines = [...next.outlines.slice(count), ...next.overflow.outlines]
    next.overflow.scripts = [...next.scripts.slice(count), ...next.overflow.scripts]
    next.outlines = next.outlines.slice(0, count)
    next.scripts = next.scripts.slice(0, count)
  } else if (count > current) {
    for (let episodeNumber = current + 1; episodeNumber <= count; episodeNumber += 1) {
      const outlineIndex = next.overflow.outlines.findIndex((item) => item.episodeNumber === episodeNumber)
      const scriptIndex = next.overflow.scripts.findIndex((item) => item.episodeNumber === episodeNumber)
      next.outlines.push(outlineIndex >= 0 ? next.overflow.outlines.splice(outlineIndex, 1)[0] : createOutline(episodeNumber))
      next.scripts.push(scriptIndex >= 0 ? next.overflow.scripts.splice(scriptIndex, 1)[0] : createScript(episodeNumber))
    }
  }
  next.planning.episodeCount = count
  next.updatedAt = new Date().toISOString()
  return next
}
