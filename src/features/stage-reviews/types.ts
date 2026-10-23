import type { ReviewableStageId } from '@/domain/project'

export interface StageReviewPayload {
  stage: ReviewableStageId
  content: Record<string, unknown>
  upstream_context: Record<string, unknown>
  user_requirements?: string
}

export interface StageReviewResult {
  passed: boolean
  issues: string[]
  revision_instructions: string[]
}

export interface StageRevisionPayload extends StageReviewPayload {
  issues: string[]
  revision_instructions: string[]
}

export interface StageRevisionResult { content: Record<string, unknown> }

export interface StageReviewApi {
  check(payload: StageReviewPayload): Promise<StageReviewResult>
  revise(payload: StageRevisionPayload): Promise<StageRevisionResult>
}
