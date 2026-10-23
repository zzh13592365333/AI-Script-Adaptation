from datetime import UTC, datetime
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, Field


MAX_CONTEXT_CHARS = 180_000


class TaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    QUALITY_FAILED = "quality_failed"
    AWAITING_HUMAN_REVIEW = "awaiting_human_review"
    COMPLETED = "completed"
    MODEL_FAILED = "model_failed"
    VALIDATION_FAILED = "validation_failed"
    CANCELLED = "cancelled"


class TaskStage(StrEnum):
    QUEUED = "queued"
    GENERATING = "generating"
    VALIDATING = "validating"
    REVIEWING = "reviewing"
    REVISING = "revising"
    HUMAN_REVIEW = "human_review"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class QualityCheckResult(BaseModel):
    passed: bool
    outline_consistency: bool
    character_consistency: bool
    continuity_consistency: bool
    format_compliance: bool
    translation_compliance: bool
    terminology_consistency: bool
    length_compliance: bool
    user_requirements_compliance: bool
    issues: list[str] = Field(default_factory=list)
    revision_instructions: list[str] = Field(default_factory=list)


class ScriptTaskCreate(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    episode_id: str = Field(min_length=1, max_length=128)
    episode_number: int = Field(ge=1, le=10_000)
    episode_outline: str = Field(min_length=1, max_length=MAX_CONTEXT_CHARS)
    character_context: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    world_context: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    previous_episode_summary: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    user_requirements: str = Field(default="", max_length=20_000)
    target_words: int = Field(default=1200, ge=300, le=5000)
    max_retries: int = Field(default=2, ge=0, le=5)


class ScriptTaskRecord(ScriptTaskCreate):
    task_id: str
    script_content: str = ""
    review_feedback: str = ""
    quality_check_result: QualityCheckResult | None = None
    retry_count: int = Field(default=0, ge=0)
    status: TaskStatus = TaskStatus.QUEUED
    current_stage: TaskStage = TaskStage.QUEUED
    final_approved: bool = False
    version: int = Field(default=0, ge=0)
    cancellation_requested: bool = False
    error_code: str | None = None
    error_message: str | None = None
    pending_review_action: str | None = None
    pending_review_idempotency_key: str | None = None
    pending_review_edited_content: str = ""
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_create(cls, task_id: str, request: ScriptTaskCreate, now: datetime | None = None) -> Self:
        timestamp = now or datetime.now(UTC)
        return cls(
            task_id=task_id,
            **request.model_dump(),
            created_at=timestamp,
            updated_at=timestamp,
        )


class ScriptTaskResponse(BaseModel):
    task_id: str
    project_id: str
    episode_id: str
    episode_number: int
    status: TaskStatus
    current_stage: TaskStage
    progress: int = Field(ge=0, le=100)
    script_content: str
    quality_check_result: QualityCheckResult | None
    retry_count: int
    max_retries: int
    final_approved: bool
    version: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class ScriptVersion(BaseModel):
    task_id: str
    version: int = Field(ge=1)
    content: str = Field(min_length=1)
    source: str
    approved: bool
    idempotency_key: str
    created_at: datetime
