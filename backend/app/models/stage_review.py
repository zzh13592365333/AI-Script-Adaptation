from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ReviewableStage(StrEnum):
    ANALYSIS = "analysis"
    ADAPTATION = "adaptation"
    PLANNING = "planning"
    OUTLINES = "outlines"


class StageReviewRequest(BaseModel):
    stage: ReviewableStage
    content: dict[str, Any]
    upstream_context: dict[str, Any] = Field(default_factory=dict)
    user_requirements: str = Field(default="", max_length=20_000)


class StageReviewResult(BaseModel):
    passed: bool
    issues: list[str] = Field(default_factory=list)
    revision_instructions: list[str] = Field(default_factory=list)


class StageRevisionRequest(StageReviewRequest):
    issues: list[str] = Field(default_factory=list)
    revision_instructions: list[str] = Field(default_factory=list)


class StageRevisionResult(BaseModel):
    content: dict[str, Any]


REQUIRED_STAGE_FIELDS: dict[ReviewableStage, set[str]] = {
    ReviewableStage.ANALYSIS: {"content"},
    ReviewableStage.ADAPTATION: {"direction", "identity", "world", "characters"},
    ReviewableStage.PLANNING: {"title", "titleCandidates", "genre", "episodeCount", "targetWords", "seriesOutline", "phasePlan"},
    ReviewableStage.OUTLINES: {"outlines"},
}


def validate_stage_content(stage: ReviewableStage, content: dict[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_STAGE_FIELDS[stage] - content.keys()
    if missing:
        raise ValueError(f"阶段修订结果缺少字段：{', '.join(sorted(missing))}")
    if stage is ReviewableStage.OUTLINES and not isinstance(content.get("outlines"), list):
        raise ValueError("阶段修订结果的 outlines 必须是数组")
    return content
