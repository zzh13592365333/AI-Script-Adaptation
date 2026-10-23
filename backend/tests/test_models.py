from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from backend.app.models.review import ReviewAction, ReviewRequest
from backend.app.models.script_task import (
    QualityCheckResult,
    ScriptTaskCreate,
    ScriptTaskRecord,
    TaskStage,
    TaskStatus,
)


def valid_request(**changes):
    data = {
        "project_id": "project-1",
        "episode_id": "episode-1",
        "episode_number": 1,
        "episode_outline": "第一集大纲",
        "character_context": "林夏，调查员",
        "world_context": "现代都市",
        "previous_episode_summary": "",
        "user_requirements": "保持悬疑感",
        "target_words": 1200,
        "max_retries": 2,
    }
    data.update(changes)
    return ScriptTaskCreate(**data)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        pytest.param("episode_number", 0, id="episode-number-low"),
        pytest.param("target_words", 299, id="target-words-low"),
        pytest.param("target_words", 5001, id="target-words-high"),
        pytest.param("max_retries", -1, id="retries-low"),
        pytest.param("max_retries", 6, id="retries-high"),
        pytest.param("episode_outline", "x" * 180_001, id="outline-too-long"),
        pytest.param("character_context", "x" * 180_001, id="characters-too-long"),
        pytest.param("world_context", "x" * 180_001, id="world-too-long"),
    ],
)
def test_script_task_create_rejects_invalid_bounds(field, value):
    with pytest.raises(ValidationError):
        valid_request(**{field: value})


def test_status_and_quality_models_serialize_with_stable_string_values():
    quality = QualityCheckResult(
        passed=False,
        outline_consistency=False,
        character_consistency=True,
        continuity_consistency=True,
        format_compliance=True,
        translation_compliance=False,
        terminology_consistency=True,
        length_compliance=True,
        user_requirements_compliance=True,
        issues=["偏离大纲"],
        revision_instructions=["恢复本集反转"],
    )
    record = ScriptTaskRecord.from_create(
        task_id="task-1",
        request=valid_request(),
        now=datetime.now(UTC),
    ).model_copy(update={"status": TaskStatus.RUNNING, "current_stage": TaskStage.REVIEWING, "quality_check_result": quality})

    payload = record.model_dump(mode="json")

    assert payload["status"] == "running"
    assert payload["current_stage"] == "reviewing"
    assert payload["quality_check_result"]["passed"] is False


def test_review_request_requires_content_or_feedback_for_relevant_actions():
    assert ReviewRequest(action=ReviewAction.ACCEPT).action == ReviewAction.ACCEPT
    with pytest.raises(ValidationError):
        ReviewRequest(action=ReviewAction.EDIT_ACCEPT)
    with pytest.raises(ValidationError):
        ReviewRequest(action=ReviewAction.REQUEST_REVISION)
    assert ReviewRequest(action=ReviewAction.EDIT_ACCEPT, edited_content="用户修订稿").edited_content
    assert ReviewRequest(action=ReviewAction.REQUEST_REVISION, feedback="加强反转").feedback
