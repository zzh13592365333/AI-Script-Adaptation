export type ScriptTaskStatus =
  | 'queued'
  | 'running'
  | 'quality_failed'
  | 'awaiting_human_review'
  | 'completed'
  | 'model_failed'
  | 'validation_failed'
  | 'cancelled'

export type ScriptTaskStage =
  | 'queued'
  | 'generating'
  | 'validating'
  | 'reviewing'
  | 'revising'
  | 'human_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface QualityCheckResult {
  passed: boolean
  outline_consistency: boolean
  character_consistency: boolean
  continuity_consistency: boolean
  format_compliance: boolean
  translation_compliance: boolean
  terminology_consistency: boolean
  length_compliance: boolean
  user_requirements_compliance: boolean
  issues: string[]
  revision_instructions: string[]
}

export interface ScriptTaskCreate {
  project_id: string
  episode_id: string
  episode_number: number
  episode_outline: string
  character_context: string
  world_context: string
  previous_episode_summary: string
  user_requirements: string
  target_words: number
  max_retries: number
}

export interface ScriptTaskResponse {
  task_id: string
  project_id: string
  episode_id: string
  episode_number: number
  status: ScriptTaskStatus
  current_stage: ScriptTaskStage
  progress: number
  script_content: string
  quality_check_result: QualityCheckResult | null
  retry_count: number
  max_retries: number
  final_approved: boolean
  version: number
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface ScriptVersion {
  task_id: string
  version: number
  content: string
  source: string
  approved: boolean
  idempotency_key: string
  created_at: string
}

export type ReviewRequest =
  | { action: 'accept'; idempotency_key?: string }
  | { action: 'edit_accept'; edited_content: string; idempotency_key?: string }
  | { action: 'request_revision'; feedback: string; idempotency_key?: string }

export interface PollOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onUpdate?: (task: ScriptTaskResponse) => void
}
