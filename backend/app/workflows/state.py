from typing import Any, TypedDict


class ScriptWorkflowState(TypedDict, total=False):
    task_id: str
    request: dict[str, Any]
    script_content: str
    deterministic_issues: list[str]
    quality_check_result: dict[str, Any] | None
    retry_count: int
    max_retries: int
    task_status: str
    current_stage: str
    review_feedback: str
    final_approved: bool
    error_code: str | None
    error_message: str | None
    human_action: str | None
