import pytest

from backend.app.models.script_task import ScriptTaskCreate, TaskStage, TaskStatus
from backend.app.repositories.database import Database
from backend.app.repositories.task_repository import TaskRepository
from backend.app.repositories.version_repository import DuplicateVersionError, VersionRepository


def request() -> ScriptTaskCreate:
    return ScriptTaskCreate(
        project_id="project-1",
        episode_id="episode-1",
        episode_number=1,
        episode_outline="第一集大纲",
        character_context="林夏，调查员",
        world_context="现代都市",
        previous_episode_summary="",
        user_requirements="保持悬疑感",
        target_words=1200,
        max_retries=2,
    )


@pytest.fixture
def repositories(tmp_path):
    database = Database(tmp_path / "tasks.sqlite3")
    database.initialize()
    return TaskRepository(database), VersionRepository(database)


def test_task_repository_round_trips_and_compare_and_sets_status(repositories):
    tasks, _ = repositories
    created = tasks.create(request(), task_id="task-1")

    assert tasks.get("task-1") == created
    assert tasks.claim("task-1", {TaskStatus.QUEUED}, TaskStatus.RUNNING, TaskStage.GENERATING)
    assert not tasks.claim("task-1", {TaskStatus.QUEUED}, TaskStatus.RUNNING, TaskStage.GENERATING)
    assert tasks.get("task-1").status == TaskStatus.RUNNING


def test_task_repository_persists_cancellation_and_lists_recoverable_tasks(repositories):
    tasks, _ = repositories
    tasks.create(request(), task_id="queued")
    tasks.create(request(), task_id="running")
    tasks.claim("running", {TaskStatus.QUEUED}, TaskStatus.RUNNING, TaskStage.GENERATING)

    assert tasks.cancel("running")
    assert tasks.get("running").cancellation_requested is True
    assert [item.task_id for item in tasks.list_recoverable()] == ["queued"]


def test_version_repository_numbers_versions_and_rejects_duplicate_idempotency(repositories):
    tasks, versions = repositories
    tasks.create(request(), task_id="task-1")

    first = versions.append("task-1", "初稿", source="model", approved=False, idempotency_key="draft-1")
    second = versions.append("task-1", "终稿", source="human", approved=True, idempotency_key="approval-1")

    assert first.version == 1
    assert second.version == 2
    assert versions.latest("task-1") == second
    assert versions.list_for_task("task-1") == [first, second]
    with pytest.raises(DuplicateVersionError):
        versions.append("task-1", "重复终稿", source="human", approved=True, idempotency_key="approval-1")


def test_updating_task_does_not_delete_existing_versions(repositories):
    tasks, versions = repositories
    tasks.create(request(), task_id="task-1")
    versions.append("task-1", "初稿", source="model", approved=False, idempotency_key="draft-1")

    tasks.update("task-1", status=TaskStatus.RUNNING, current_stage=TaskStage.REVIEWING)

    assert versions.latest("task-1").content == "初稿"
