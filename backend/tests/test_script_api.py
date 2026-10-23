import time

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.core.config import Settings
from backend.app.main import create_app
from backend.app.repositories.database import Database
from backend.app.repositories.task_repository import TaskRepository
from backend.app.repositories.version_repository import VersionRepository
from backend.app.services.model_provider import FakeScriptModelProvider
from backend.app.services.task_service import TaskService
from backend.tests.test_task_service import quality
from backend.tests.test_validators import VALID_SCRIPT


def payload():
    return {
        "project_id": "project-1",
        "episode_id": "episode-1",
        "episode_number": 1,
        "episode_outline": "林夏在档案室发现秘密，并接到神秘电话。",
        "character_context": "林夏：谨慎的调查员",
        "world_context": "现代都市悬疑",
        "previous_episode_summary": "",
        "user_requirements": "结尾出现电话",
        "target_words": 300,
        "max_retries": 2,
    }


def test_script_task_api_contract_and_human_review(tmp_path):
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        max_input_chars=1000,
    )
    database = Database(settings.database_path)
    database.initialize()
    service = TaskService(
        settings,
        TaskRepository(database),
        VersionRepository(database),
        FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)]),
        InMemorySaver(),
    )
    client = TestClient(create_app(settings, task_service=service))
    try:
        created = client.post("/api/script-tasks", json=payload())
        assert created.status_code == 202
        task_id = created.json()["task_id"]

        deadline = time.monotonic() + 3
        current = None
        while time.monotonic() < deadline:
            current = client.get(f"/api/script-tasks/{task_id}")
            if current.json()["status"] == "awaiting_human_review":
                break
            time.sleep(0.02)
        assert current is not None
        assert current.json()["current_stage"] == "human_review"
        assert current.json()["quality_check_result"]["passed"] is True

        result = client.get(f"/api/script-tasks/{task_id}/result")
        assert result.status_code == 200
        assert result.json()["script_content"] == VALID_SCRIPT

        reviewed = client.post(
            f"/api/script-tasks/{task_id}/review",
            json={"action": "accept", "idempotency_key": "api-accept"},
        )
        assert reviewed.status_code == 202

        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            current = client.get(f"/api/script-tasks/{task_id}")
            if current.json()["status"] == "completed":
                break
            time.sleep(0.02)
        versions = client.get(f"/api/script-tasks/{task_id}/versions")
        assert versions.status_code == 200
        assert versions.json()[-1]["approved"] is True
    finally:
        service.shutdown()


def test_script_task_api_rejects_invalid_input_and_handles_missing_tasks(tmp_path):
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        max_input_chars=1000,
    )
    database = Database(settings.database_path)
    database.initialize()
    service = TaskService(
        settings,
        TaskRepository(database),
        VersionRepository(database),
        FakeScriptModelProvider(),
        InMemorySaver(),
    )
    client = TestClient(create_app(settings, task_service=service))
    try:
        oversized = payload()
        oversized["character_context"] = "x" * 1001
        assert client.post("/api/script-tasks", json=oversized).status_code == 422
        assert client.get("/api/script-tasks/missing").status_code == 404
        assert client.post("/api/script-tasks/missing/cancel").status_code == 404
    finally:
        service.shutdown()
