from backend.app.models.stage_review import (
    StageReviewRequest,
    StageReviewResult,
    StageRevisionRequest,
    StageRevisionResult,
)
from backend.app.services.model_provider import FakeScriptModelProvider
from backend.app.workflows.stage_review_graph import build_stage_review_graph


def review_request() -> StageReviewRequest:
    return StageReviewRequest(
        stage="adaptation",
        content={"direction": "都市悬疑", "identity": "调查员", "world": "临江城", "characters": "林夏"},
        upstream_context={"analysis": "核心冲突是信托文件争夺"},
    )


def test_review_returns_issue_list_without_revising_content():
    expected = StageReviewResult(
        passed=False,
        issues=["主角目标不够具体"],
        revision_instructions=["补充主角必须在二十四小时内找到文件的目标"],
    )
    provider = FakeScriptModelProvider(stage_review_results=[expected])
    graph = build_stage_review_graph(provider)

    result = graph.invoke({"operation": "check", "review_request": review_request().model_dump()})

    assert result["review_result"] == expected.model_dump()
    assert "revision_result" not in result
    assert [call.operation for call in provider.calls] == ["review_stage"]


def test_revision_returns_stage_structured_content():
    expected = StageRevisionResult(
        content={"direction": "都市悬疑", "identity": "限时调查员", "world": "临江城", "characters": "林夏"}
    )
    provider = FakeScriptModelProvider(stage_revision_results=[expected])
    graph = build_stage_review_graph(provider)
    request = StageRevisionRequest.model_validate(review_request().model_dump() | {
        "issues": ["主角目标不够具体"],
        "revision_instructions": ["增加限时目标"],
        "user_requirements": "保留人物姓名",
    })

    result = graph.invoke({"operation": "revise", "revision_request": request.model_dump()})

    assert result["revision_result"] == expected.model_dump()
    assert [call.operation for call in provider.calls] == ["revise_stage"]


def test_revision_rejects_missing_required_stage_fields():
    provider = FakeScriptModelProvider(stage_revision_results=[StageRevisionResult(content={"direction": "只有方向"})])
    graph = build_stage_review_graph(provider)
    request = StageRevisionRequest.model_validate(review_request().model_dump() | {
        "issues": [],
        "revision_instructions": [],
        "user_requirements": "重新生成",
    })

    try:
        graph.invoke({"operation": "revise", "revision_request": request.model_dump()})
    except ValueError as error:
        assert "缺少字段" in str(error)
    else:
        raise AssertionError("expected invalid stage content to be rejected")
