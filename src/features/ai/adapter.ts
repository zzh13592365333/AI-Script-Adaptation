import type { EpisodeOutline, Project } from '@/domain/project'

export interface SourceAnalysisResult { content: string }
export interface AdaptationResult { direction: string; identity: string; world: string; characters: string }
export interface SeriesPlanResult { titleCandidates: string[]; genre: string; seriesOutline: string; phasePlan: string }
export interface OutlineJobInput { project: Project; prompt?: string }
export interface OutlineJob { jobId: string }
export interface OutlineJobStatus {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  outlines?: EpisodeOutline[]
  error?: string
}
export interface EpisodeGenerationInput { episodeNumber: number; outline: string; targetWords: number; context?: string; previousSummary?: string; prompt?: string }
export interface RewriteInput extends EpisodeGenerationInput { script: string; instruction: string }
export interface StreamCallbacks { onStart?: (taskId: string) => void; onChunk: (chunk: string) => void; onComplete?: () => void }
export type PartialResultCallback<T> = (partial: Partial<T>) => void
export type OutlineStreamCallback = (outline: EpisodeOutline, progress: number) => void

export interface AiAdapter {
  analyzeSource(input: { sourceText: string; prompt?: string }, callbacks?: StreamCallbacks): Promise<SourceAnalysisResult>
  generateAdaptation(input: { sourceAnalysis: string; targetMarket: string; instruction: string; prompt?: string }, onPartial?: PartialResultCallback<AdaptationResult>): Promise<AdaptationResult>
  generateSeriesPlan(input: { adaptation: string; episodeCount: number; targetWords: number; prompt?: string }, onPartial?: PartialResultCallback<SeriesPlanResult>): Promise<SeriesPlanResult>
  createOutlineJob(input: OutlineJobInput, onOutline?: OutlineStreamCallback): Promise<OutlineJob>
  getJob(jobId: string): Promise<OutlineJobStatus>
  generateEpisode(input: EpisodeGenerationInput, callbacks: StreamCallbacks): Promise<void>
  rewriteEpisode(input: RewriteInput, callbacks: StreamCallbacks): Promise<void>
  stopGeneration(taskId: string): Promise<void>
}
