from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from backend.app.models.stage_review import (
    StageReviewRequest,
    StageRevisionRequest,
    validate_stage_content,
)
from backend.app.services.model_provider import ScriptModelProvider


class StageReviewWorkflowState(TypedDict, total=False):
    operation: Literal["check", "revise"]
    review_request: dict[str, Any]
    revision_request: dict[str, Any]
    review_result: dict[str, Any]
    revision_result: dict[str, Any]


def build_stage_review_graph(provider: ScriptModelProvider):
    graph = StateGraph(StageReviewWorkflowState)

    def check(state: StageReviewWorkflowState) -> StageReviewWorkflowState:
        request = StageReviewRequest.model_validate(state["review_request"])
        return {"review_result": provider.review_stage(request).model_dump(mode="json")}

    def revise(state: StageReviewWorkflowState) -> StageReviewWorkflowState:
        request = StageRevisionRequest.model_validate(state["revision_request"])
        result = provider.revise_stage(request)
        validate_stage_content(request.stage, result.content)
        return {"revision_result": result.model_dump(mode="json")}

    def route(state: StageReviewWorkflowState) -> str:
        return state["operation"]

    graph.add_node("check", check)
    graph.add_node("revise", revise)
    graph.add_conditional_edges(START, route, {"check": "check", "revise": "revise"})
    graph.add_edge("check", END)
    graph.add_edge("revise", END)
    return graph.compile()
