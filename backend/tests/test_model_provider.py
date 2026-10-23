import pytest
from pydantic import ValidationError

from backend.app.core.config import Settings
from backend.app.models.script_task import QualityCheckResult, ScriptTaskCreate
from backend.app.models.stage_review import StageRevisionRequest, StageRevisionResult
from backend.app.services.model_provider import (
    FakeScriptModelProvider,
    ModelProviderError,
    OpenAICompatibleProvider,
    coerce_quality_result,
    map_provider_error,
)


def task_request() -> ScriptTaskCreate:
    return ScriptTaskCreate(
        project_id="project-1",
        episode_id="episode-1",
        episode_number=1,
        episode_outline="林夏发现被撕掉的档案页",
        character_context="林夏：谨慎的调查员",
        world_context="现代都市悬疑",
        previous_episode_summary="",
        user_requirements="结尾必须出现新的电话",
        target_words=1200,
        max_retries=2,
    )


def quality(passed: bool) -> QualityCheckResult:
    return QualityCheckResult(
        passed=passed,
        outline_consistency=passed,
        character_consistency=True,
        continuity_consistency=True,
        format_compliance=True,
        translation_compliance=True,
        terminology_consistency=True,
        length_compliance=True,
        user_requirements_compliance=passed,
        issues=[] if passed else ["遗漏结尾电话"],
        revision_instructions=[] if passed else ["补充结尾电话"],
    )


def test_fake_provider_returns_queued_results_and_records_calls():
    provider = FakeScriptModelProvider(
        script_results=["初稿", "修订稿"],
        review_results=[quality(False), quality(True)],
    )
    request = task_request()

    assert provider.generate_script(request) == "初稿"
    assert provider.review_script(request, "初稿", []) == quality(False)
    assert provider.revise_script(request, "初稿", ["补充结尾电话"]) == "修订稿"
    assert provider.review_script(request, "修订稿", []) == quality(True)
    assert [call.operation for call in provider.calls] == ["generate", "review", "revise", "review"]


def test_quality_result_rejects_invalid_structured_output():
    with pytest.raises(ValidationError):
        coerce_quality_result({"passed": True, "issues": []})


def test_provider_errors_are_classified_without_secrets():
    error = map_provider_error(TimeoutError("request to sk-private-value timed out"))

    assert error.code == "model_timeout"
    assert "sk-private-value" not in str(error)


def test_openai_provider_requires_complete_configuration(tmp_path):
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        model_base_url="https://provider.example/v1",
        model_api_key="",
        model_name="comic-model",
    )

    with pytest.raises(ModelProviderError, match="模型服务尚未完整配置"):
        OpenAICompatibleProvider(settings)


def test_openai_provider_uses_function_calling_for_structured_outputs(monkeypatch, tmp_path):
    methods: list[str | None] = []

    class FakeChatModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def with_structured_output(self, schema, *, method=None):
            methods.append(method)
            return object()

    monkeypatch.setattr("backend.app.services.model_provider.ChatOpenAI", FakeChatModel)
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        model_base_url="https://provider.example/v1",
        model_api_key="test-key",
        model_name="comic-model",
    )

    OpenAICompatibleProvider(settings)

    assert methods == ["function_calling", "function_calling", "function_calling"]


def test_stage_revision_retries_when_first_result_is_missing_required_fields(monkeypatch, tmp_path):
    revision_results = iter([
        {"content": {"direction": "只有方向"}},
        {
            "content": {
                "direction": "竖屏生存漫剧",
                "identity": "灾荒求生",
                "world": "古代荒年村落",
                "characters": "安安与哑叔",
            }
        },
    ])
    revision_calls = 0

    class FakeStructuredModel:
        def invoke(self, messages):
            nonlocal revision_calls
            revision_calls += 1
            return next(revision_results)

    class FakeChatModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def with_structured_output(self, schema, *, method=None):
            if schema is StageRevisionResult:
                return FakeStructuredModel()
            return object()

    monkeypatch.setattr("backend.app.services.model_provider.ChatOpenAI", FakeChatModel)
    provider = OpenAICompatibleProvider(Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        model_base_url="https://provider.example/v1",
        model_api_key="test-key",
        model_name="comic-model",
    ))
    request = StageRevisionRequest(
        stage="adaptation",
        content={"direction": "旧方向", "identity": "旧身份", "world": "旧世界", "characters": "旧人物"},
        issues=["世界观不足"],
        revision_instructions=["补充完整设定"],
    )

    result = provider.revise_stage(request)

    assert revision_calls == 2
    assert result.content["world"] == "古代荒年村落"
