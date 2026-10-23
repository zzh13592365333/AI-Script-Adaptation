from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.models.stage_review import StageReviewResult, StageRevisionResult
from backend.app.services.model_provider import FakeScriptModelProvider, ModelProviderError


def check_payload():
    return {
        "stage": "analysis",
        "content": {"content": "人物与冲突分析"},
        "upstream_context": {"source": "原稿摘要"},
        "user_requirements": "突出视觉钩子",
    }


def test_stage_review_api_checks_and_revises_structured_content(tmp_path):
    provider = FakeScriptModelProvider(
        stage_review_results=[StageReviewResult(passed=False, issues=["缺少视觉钩子"], revision_instructions=["补充三个关键画面"])],
        stage_revision_results=[StageRevisionResult(content={"content": "人物、冲突与三个关键画面"})],
    )
    app = create_app(Settings(database_path=tmp_path / "tasks.sqlite3", checkpoint_path=tmp_path / "cp.sqlite3"), stage_review_provider=provider)

    with TestClient(app) as client:
        checked = client.post("/api/stage-reviews/check", json=check_payload())
        revised = client.post("/api/stage-reviews/revise", json=check_payload() | {
            "issues": checked.json()["issues"],
            "revision_instructions": checked.json()["revision_instructions"],
        })

    assert checked.status_code == 200
    assert checked.json()["passed"] is False
    assert revised.status_code == 200
    assert revised.json()["content"]["content"].endswith("三个关键画面")


def test_stage_review_api_maps_provider_failure_without_secret_details(tmp_path):
    provider = FakeScriptModelProvider(failures={"review_stage": ModelProviderError("model_timeout", "模型请求超时，请稍后重试")})
    app = create_app(Settings(database_path=tmp_path / "tasks.sqlite3", checkpoint_path=tmp_path / "cp.sqlite3"), stage_review_provider=provider)

    with TestClient(app) as client:
        response = client.post("/api/stage-reviews/check", json=check_payload())

    assert response.status_code == 502
    assert response.json() == {"detail": "模型请求超时，请稍后重试"}
