from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_health_reports_backend_without_exposing_secrets(tmp_path):
    from backend.app.core.config import Settings

    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        model_api_key="private-test-key",
    )
    response = TestClient(create_app(settings)).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "ai-comic-workflow-backend",
        "database": "sqlite",
        "model_configured": False,
    }
    assert "private-test-key" not in response.text
    assert "api_key" not in response.text.lower()
