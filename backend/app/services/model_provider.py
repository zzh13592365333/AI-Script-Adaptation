from collections import deque
from dataclasses import dataclass
from typing import Any, Protocol

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from backend.app.core.config import Settings
from backend.app.models.script_task import QualityCheckResult, ScriptTaskCreate
from backend.app.models.stage_review import (
    StageReviewRequest,
    StageReviewResult,
    StageRevisionRequest,
    StageRevisionResult,
    validate_stage_content,
)
from backend.app.services.prompts import (
    REVIEW_SYSTEM_PROMPT,
    SCRIPT_SYSTEM_PROMPT,
    STAGE_REVIEW_SYSTEM_PROMPT,
    STAGE_REVISION_SYSTEM_PROMPT,
    generation_prompt,
    review_prompt,
    revision_prompt,
    stage_review_prompt,
    stage_revision_prompt,
)


class ModelProviderError(RuntimeError):
    def __init__(self, code: str, public_message: str):
        super().__init__(public_message)
        self.code = code
        self.public_message = public_message


class ScriptModelProvider(Protocol):
    def generate_script(self, request: ScriptTaskCreate) -> str: ...

    def revise_script(self, request: ScriptTaskCreate, current_script: str, feedback: list[str]) -> str: ...

    def review_script(
        self,
        request: ScriptTaskCreate,
        script: str,
        deterministic_issues: list[str],
    ) -> QualityCheckResult: ...

    def review_stage(self, request: StageReviewRequest) -> StageReviewResult: ...

    def revise_stage(self, request: StageRevisionRequest) -> StageRevisionResult: ...


def coerce_quality_result(value: Any) -> QualityCheckResult:
    return QualityCheckResult.model_validate(value)


def map_provider_error(error: Exception) -> ModelProviderError:
    if isinstance(error, ModelProviderError):
        return error
    name = type(error).__name__.lower()
    if isinstance(error, TimeoutError) or "timeout" in name:
        return ModelProviderError("model_timeout", "模型请求超时，请稍后重试")
    if "ratelimit" in name or "rate_limit" in name:
        return ModelProviderError("model_rate_limited", "模型服务请求过于频繁，请稍后重试")
    if isinstance(error, (ValueError, TypeError)) or "validation" in name or "json" in name or "outputparser" in name:
        return ModelProviderError("model_invalid_output", "模型返回了无效的结构化结果")
    return ModelProviderError("model_request_failed", "模型服务调用失败")


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings):
        if not settings.model_configured:
            raise ModelProviderError("model_not_configured", "模型服务尚未完整配置")
        self.model = ChatOpenAI(
            base_url=settings.model_base_url,
            api_key=settings.model_api_key,
            model=settings.model_name,
            reasoning_effort=settings.model_reasoning_effort,
            timeout=120,
            max_retries=2,
        )
        self.review_model = self.model.with_structured_output(QualityCheckResult, method="function_calling")
        self.stage_review_model = self.model.with_structured_output(StageReviewResult, method="function_calling")
        self.stage_revision_model = self.model.with_structured_output(StageRevisionResult, method="function_calling")

    def generate_script(self, request: ScriptTaskCreate) -> str:
        return self._text(SCRIPT_SYSTEM_PROMPT, generation_prompt(request))

    def revise_script(self, request: ScriptTaskCreate, current_script: str, feedback: list[str]) -> str:
        return self._text(SCRIPT_SYSTEM_PROMPT, revision_prompt(request, current_script, feedback))

    def review_script(
        self,
        request: ScriptTaskCreate,
        script: str,
        deterministic_issues: list[str],
    ) -> QualityCheckResult:
        try:
            result = self.review_model.invoke(
                [SystemMessage(content=REVIEW_SYSTEM_PROMPT), HumanMessage(content=review_prompt(request, script, deterministic_issues))]
            )
            return coerce_quality_result(result)
        except Exception as error:
            raise map_provider_error(error) from None

    def review_stage(self, request: StageReviewRequest) -> StageReviewResult:
        try:
            result = self.stage_review_model.invoke([
                SystemMessage(content=STAGE_REVIEW_SYSTEM_PROMPT),
                HumanMessage(content=stage_review_prompt(request)),
            ])
            return StageReviewResult.model_validate(result)
        except Exception as error:
            raise map_provider_error(error) from None

    def revise_stage(self, request: StageRevisionRequest) -> StageRevisionResult:
        messages = [
            SystemMessage(content=STAGE_REVISION_SYSTEM_PROMPT),
            HumanMessage(content=stage_revision_prompt(request)),
        ]
        for attempt in range(2):
            try:
                result = StageRevisionResult.model_validate(self.stage_revision_model.invoke(messages))
                validate_stage_content(request.stage, result.content)
                return result
            except Exception as error:
                mapped = map_provider_error(error)
                if mapped.code == "model_invalid_output" and attempt == 0:
                    continue
                raise mapped from None
        raise ModelProviderError("model_invalid_output", "模型返回了无效的结构化结果")

    def _text(self, system_prompt: str, user_prompt: str) -> str:
        try:
            result = self.model.invoke(
                [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
            )
            content = result.content
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty model content")
            return content
        except Exception as error:
            raise map_provider_error(error) from None


@dataclass(frozen=True)
class ProviderCall:
    operation: str


class FakeScriptModelProvider:
    def __init__(
        self,
        *,
        script_results: list[str] | None = None,
        review_results: list[QualityCheckResult] | None = None,
        stage_review_results: list[StageReviewResult] | None = None,
        stage_revision_results: list[StageRevisionResult] | None = None,
        failures: dict[str, Exception] | None = None,
    ):
        self.script_results = deque(script_results or [])
        self.review_results = deque(review_results or [])
        self.stage_review_results = deque(stage_review_results or [])
        self.stage_revision_results = deque(stage_revision_results or [])
        self.failures = failures or {}
        self.calls: list[ProviderCall] = []

    def generate_script(self, request: ScriptTaskCreate) -> str:
        self.calls.append(ProviderCall("generate"))
        self._raise_if_configured("generate")
        if not self.script_results:
            raise ModelProviderError("fake_result_missing", "测试模型缺少生成结果")
        return self.script_results.popleft()

    def revise_script(self, request: ScriptTaskCreate, current_script: str, feedback: list[str]) -> str:
        self.calls.append(ProviderCall("revise"))
        self._raise_if_configured("revise")
        if not self.script_results:
            raise ModelProviderError("fake_result_missing", "测试模型缺少修订结果")
        return self.script_results.popleft()

    def review_script(
        self,
        request: ScriptTaskCreate,
        script: str,
        deterministic_issues: list[str],
    ) -> QualityCheckResult:
        self.calls.append(ProviderCall("review"))
        self._raise_if_configured("review")
        if not self.review_results:
            raise ModelProviderError("fake_result_missing", "测试模型缺少质检结果")
        return self.review_results.popleft()

    def review_stage(self, request: StageReviewRequest) -> StageReviewResult:
        self.calls.append(ProviderCall("review_stage"))
        self._raise_if_configured("review_stage")
        if not self.stage_review_results:
            raise ModelProviderError("fake_result_missing", "测试模型缺少阶段自查结果")
        return self.stage_review_results.popleft()

    def revise_stage(self, request: StageRevisionRequest) -> StageRevisionResult:
        self.calls.append(ProviderCall("revise_stage"))
        self._raise_if_configured("revise_stage")
        if not self.stage_revision_results:
            raise ModelProviderError("fake_result_missing", "测试模型缺少阶段修订结果")
        return self.stage_revision_results.popleft()

    def _raise_if_configured(self, operation: str) -> None:
        error = self.failures.get(operation)
        if error is not None:
            raise map_provider_error(error)
