from collections.abc import Callable
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from backend.app.models.script_task import QualityCheckResult, ScriptTaskCreate
from backend.app.services.model_provider import ModelProviderError, ScriptModelProvider
from backend.app.workflows.state import ScriptWorkflowState
from backend.app.workflows.validators import validate_script


CancellationCheck = Callable[[str], bool]


def initial_workflow_state(task_id: str, request: ScriptTaskCreate) -> ScriptWorkflowState:
    return {
        "task_id": task_id,
        "request": request.model_dump(mode="json"),
        "script_content": "",
        "deterministic_issues": [],
        "quality_check_result": None,
        "retry_count": 0,
        "max_retries": request.max_retries,
        "task_status": "queued",
        "current_stage": "queued",
        "review_feedback": "",
        "final_approved": False,
        "error_code": None,
        "error_message": None,
        "human_action": None,
    }


def build_script_graph(provider: ScriptModelProvider, checkpointer, cancellation_check: CancellationCheck):
    graph = StateGraph(ScriptWorkflowState)

    def cancelled(state: ScriptWorkflowState) -> bool:
        return cancellation_check(state["task_id"])

    def cancellation_update() -> ScriptWorkflowState:
        return {"task_status": "cancelled", "current_stage": "cancelled"}

    def failure_update(error: ModelProviderError) -> ScriptWorkflowState:
        return {
            "task_status": "model_failed",
            "current_stage": "failed",
            "error_code": error.code,
            "error_message": error.public_message,
        }

    def generate(state: ScriptWorkflowState) -> ScriptWorkflowState:
        if cancelled(state):
            return cancellation_update()
        request = ScriptTaskCreate.model_validate(state["request"])
        try:
            script = provider.generate_script(request)
        except ModelProviderError as error:
            return failure_update(error)
        if cancelled(state):
            return cancellation_update()
        return {
            "script_content": script,
            "task_status": "running",
            "current_stage": "validating",
        }

    def validate(state: ScriptWorkflowState) -> ScriptWorkflowState:
        if cancelled(state):
            return cancellation_update()
        request = ScriptTaskCreate.model_validate(state["request"])
        return {
            "deterministic_issues": validate_script(state.get("script_content", ""), request),
            "task_status": "running",
            "current_stage": "reviewing",
        }

    def review(state: ScriptWorkflowState) -> ScriptWorkflowState:
        if cancelled(state):
            return cancellation_update()
        request = ScriptTaskCreate.model_validate(state["request"])
        deterministic_issues = state.get("deterministic_issues", [])
        try:
            result = provider.review_script(request, state.get("script_content", ""), deterministic_issues)
        except ModelProviderError as error:
            return failure_update(error)
        if cancelled(state):
            return cancellation_update()
        merged = _merge_quality_result(result, deterministic_issues)
        return {
            "quality_check_result": merged.model_dump(mode="json"),
            "task_status": "running" if merged.passed else "quality_failed",
            "current_stage": "reviewing",
        }

    def revise(state: ScriptWorkflowState) -> ScriptWorkflowState:
        if cancelled(state):
            return cancellation_update()
        request = ScriptTaskCreate.model_validate(state["request"])
        quality = QualityCheckResult.model_validate(state.get("quality_check_result") or _empty_quality())
        feedback = list(quality.revision_instructions or quality.issues)
        if state.get("review_feedback"):
            feedback.append(state["review_feedback"])
        try:
            script = provider.revise_script(request, state.get("script_content", ""), feedback)
        except ModelProviderError as error:
            return failure_update(error)
        if cancelled(state):
            return cancellation_update()
        return {
            "script_content": script,
            "retry_count": state.get("retry_count", 0) + 1,
            "review_feedback": "",
            "human_action": None,
            "task_status": "running",
            "current_stage": "validating",
        }

    def prepare_human_review(state: ScriptWorkflowState) -> ScriptWorkflowState:
        return {"task_status": "awaiting_human_review", "current_stage": "human_review"}

    def human_review(state: ScriptWorkflowState) -> ScriptWorkflowState:
        decision = interrupt(
            {
                "task_id": state["task_id"],
                "script_content": state.get("script_content", ""),
                "quality_check_result": state.get("quality_check_result"),
                "retry_count": state.get("retry_count", 0),
            }
        )
        action = str(decision.get("action", ""))
        if action == "accept":
            return {
                "human_action": action,
                "final_approved": True,
                "task_status": "completed",
                "current_stage": "completed",
            }
        if action == "edit_accept":
            content = str(decision.get("edited_content", "")).strip()
            if not content:
                return {
                    "error_code": "invalid_review",
                    "error_message": "编辑后接受必须提供剧本内容",
                    "task_status": "awaiting_human_review",
                    "current_stage": "human_review",
                }
            return {
                "human_action": action,
                "script_content": content,
                "final_approved": True,
                "task_status": "completed",
                "current_stage": "completed",
            }
        if action == "request_revision":
            return {
                "human_action": action,
                "review_feedback": str(decision.get("feedback", "")).strip(),
                "task_status": "running",
                "current_stage": "revising",
            }
        return {
            "error_code": "invalid_review",
            "error_message": "不支持的人工审核操作",
            "task_status": "awaiting_human_review",
            "current_stage": "human_review",
        }

    def route_operation(state: ScriptWorkflowState) -> str:
        if state.get("task_status") in {"cancelled", "model_failed", "validation_failed"}:
            return "end"
        return "continue"

    def route_quality(state: ScriptWorkflowState) -> str:
        if state.get("task_status") in {"cancelled", "model_failed", "validation_failed"}:
            return "end"
        quality = state.get("quality_check_result") or {}
        if quality.get("passed"):
            return "human"
        if state.get("retry_count", 0) < state.get("max_retries", 0):
            return "revise"
        return "human"

    def route_human(state: ScriptWorkflowState) -> str:
        return "revise" if state.get("human_action") == "request_revision" else "end"

    graph.add_node("generate_script", generate)
    graph.add_node("validate_structure", validate)
    graph.add_node("review_quality", review)
    graph.add_node("revise_script", revise)
    graph.add_node("prepare_human_review", prepare_human_review)
    graph.add_node("human_review", human_review)
    graph.add_edge(START, "generate_script")
    graph.add_conditional_edges("generate_script", route_operation, {"continue": "validate_structure", "end": END})
    graph.add_conditional_edges("validate_structure", route_operation, {"continue": "review_quality", "end": END})
    graph.add_conditional_edges(
        "review_quality",
        route_quality,
        {"revise": "revise_script", "human": "prepare_human_review", "end": END},
    )
    graph.add_conditional_edges("revise_script", route_operation, {"continue": "validate_structure", "end": END})
    graph.add_edge("prepare_human_review", "human_review")
    graph.add_conditional_edges("human_review", route_human, {"revise": "revise_script", "end": END})
    return graph.compile(checkpointer=checkpointer)


def _empty_quality() -> dict[str, Any]:
    return {
        "passed": False,
        "outline_consistency": False,
        "character_consistency": False,
        "continuity_consistency": False,
        "format_compliance": False,
        "translation_compliance": False,
        "terminology_consistency": False,
        "length_compliance": False,
        "user_requirements_compliance": False,
        "issues": [],
        "revision_instructions": [],
    }


def _merge_quality_result(result: QualityCheckResult, deterministic_issues: list[str]) -> QualityCheckResult:
    if not deterministic_issues:
        return result
    issues = list(dict.fromkeys([*result.issues, *deterministic_issues]))
    instructions = list(dict.fromkeys([*result.revision_instructions, *deterministic_issues]))
    return result.model_copy(
        update={
            "passed": False,
            "format_compliance": result.format_compliance and not any("场景" in issue or "人物" in issue for issue in deterministic_issues),
            "translation_compliance": result.translation_compliance and not any("翻译" in issue for issue in deterministic_issues),
            "length_compliance": result.length_compliance and not any("篇幅" in issue for issue in deterministic_issues),
            "issues": issues,
            "revision_instructions": instructions,
        }
    )
