from fastapi.testclient import TestClient

from backend.app.api.openai_proxy import OpenAIChatRequest, build_upstream_request
from backend.app.core.config import Settings
from backend.app.main import create_app


def test_proxy_rejects_requests_when_model_is_not_configured(tmp_path):
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
    )

    response = TestClient(create_app(settings)).post(
        "/api/openai/chat",
        json={"messages": [{"role": "user", "content": "hello"}], "stream": True},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "模型服务尚未完整配置"}


def test_build_upstream_request_uses_configured_model_without_exposing_key():
    settings = Settings(
        model_base_url="https://provider.example/v1/",
        model_api_key="private-key",
        model_name="fast-model",
        model_reasoning_effort="low",
    )
    payload = OpenAIChatRequest(
        messages=[{"role": "user", "content": "hello"}],
        stream=True,
    )

    request = build_upstream_request(payload, settings)

    assert request.url == "https://provider.example/v1/chat/completions"
    assert request.body == {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": True,
        "model": "fast-model",
        "reasoning_effort": "low",
    }
    assert request.headers["Authorization"] == "Bearer private-key"
    assert "private-key" not in repr(request.body)
