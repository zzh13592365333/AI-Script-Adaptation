import { createOutline, createScript, type NodeStatus, type Project, type ReviewableStageId, type StageId, type StageVersion } from './project'

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

function invalidateReview(project: Project, stages: ReviewableStageId[]) {
  stages.forEach((stage) => {
    const review = project.stageReviews[stage]
    review.status = 'idle'
    review.checkedVersion = null
    review.issues = []
    review.revisionInstructions = []
    review.error = undefined
  })
}

export function markDirty(project: Project, source: DirtySource): Project {
  const next = cloneProject(project)
  next.updatedAt = new Date().toISOString()

  if (source.type === 'source' || source.type === 'analysis') {
    invalidateReview(next, ['analysis', 'adaptation', 'planning', 'outlines'])
    next.analysis.status = dirty(next.analysis.status)
    next.adaptation.status = dirty(next.adaptation.status)
    next.planning.status = dirty(next.planning.status)
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'adaptation') {
    invalidateReview(next, ['adaptation', 'planning', 'outlines'])
    next.planning.status = dirty(next.planning.status)
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'planning') {
    invalidateReview(next, ['planning', 'outlines'])
    next.outlines.forEach((item) => { item.status = dirty(item.status) })
    next.scripts.forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'outline') {
    invalidateReview(next, ['outlines'])
    next.scripts.slice(source.episodeNumber - 1).forEach((item) => { item.status = dirty(item.status) })
  } else if (source.type === 'script') {
    const following = next.scripts[source.episodeNumber]
    if (following) following.summaryStale = true
  }
  return next
}

export function recordStageVersion(
  project: Project,
  stage: ReviewableStageId,
  content: unknown,
  source: StageVersion['source']
): Project {
  const next = cloneProject(project)
  const review = next.stageReviews[stage]
  const version = review.currentVersion + 1
  review.currentVersion = version
  review.status = 'idle'
  review.checkedVersion = null
  review.issues = []
  review.revisionInstructions = []
  review.error = undefined
  review.versions.push({ version, content, source, confirmed: false, createdAt: new Date().toISOString() })
  return next
}

export function markStageChecked(
  project: Project,
  stage: ReviewableStageId,
  passed: boolean,
  issues: string[],
  revisionInstructions: string[]
): Project {
  const next = cloneProject(project)
  const review = next.stageReviews[stage]
  review.status = passed ? 'passed' : 'issues_found'
  review.checkedVersion = review.currentVersion
  review.issues = [...issues]
  review.revisionInstructions = [...revisionInstructions]
  review.error = undefined
  return next
}

export function canConfirmStage(project: Project, stage: ReviewableStageId): GateResult {
  const review = project.stageReviews[stage]
  if (!review.currentVersion) return { allowed: false, reason: '请先生成当前阶段内容' }
  return { allowed: true }
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
