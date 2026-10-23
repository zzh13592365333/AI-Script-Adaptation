from enum import StrEnum
from typing import Any, Protocol, Self

from pydantic import BaseModel, Field, model_validator


class MediaToolStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MediaToolRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=128)
    episode_id: str = Field(min_length=1, max_length=128)
    prompt: str = Field(min_length=1, max_length=100_000)
    input_references: list[str] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)


class MediaToolResult(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=160)
    status: MediaToolStatus
    output_reference: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_completed_output(self) -> Self:
        if self.status is MediaToolStatus.COMPLETED and not self.output_reference:
            raise ValueError("completed media result requires output_reference")
        return self


class CharacterImageTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...


class SceneImageTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...


class StoryboardTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...


class VideoClipTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...


class VoiceTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...


class CompositionTool(Protocol):
    def run(self, request: MediaToolRequest) -> MediaToolResult: ...
