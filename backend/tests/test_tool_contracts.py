import pytest
from pydantic import ValidationError

from backend.app.tools.contracts import MediaToolRequest, MediaToolResult, MediaToolStatus


def test_media_tool_request_requires_idempotency_key_and_typed_inputs():
    request = MediaToolRequest(
        idempotency_key="project-1-episode-1-character-1",
        project_id="project-1",
        episode_id="episode-1",
        prompt="Character reference sheet",
        input_references=["asset://character-brief"],
    )

    assert request.idempotency_key == "project-1-episode-1-character-1"
    assert request.input_references == ["asset://character-brief"]
    with pytest.raises(ValidationError):
        MediaToolRequest(idempotency_key="", project_id="p", episode_id="e", prompt="x")


def test_media_tool_result_tracks_status_output_and_retryability():
    result = MediaToolResult(
        idempotency_key="job-1",
        status=MediaToolStatus.FAILED,
        error_code="provider_timeout",
        error_message="Provider timed out",
        retryable=True,
    )

    assert result.status is MediaToolStatus.FAILED
    assert result.output_reference is None
    assert result.retryable is True


def test_completed_media_result_requires_real_output_reference():
    with pytest.raises(ValidationError):
        MediaToolResult(idempotency_key="job-1", status=MediaToolStatus.COMPLETED)

    completed = MediaToolResult(
        idempotency_key="job-1",
        status=MediaToolStatus.COMPLETED,
        output_reference="asset://rendered-output",
    )
    assert completed.output_reference == "asset://rendered-output"
