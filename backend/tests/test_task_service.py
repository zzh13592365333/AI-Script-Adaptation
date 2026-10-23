from threading import Event
import time

from langgraph.checkpoint.memory import InMemorySaver

from backend.app.core.config import Settings
from backend.app.models.review import ReviewAction, ReviewRequest
from backend.app.models.script_task import QualityCheckResult, ScriptTaskCreate, TaskStatus
from backend.app.repositories.database import Database
from backend.app.repositories.task_repository import TaskRepository
from backend.app.repositories.version_repository import VersionRepository
from backend.app.services.model_provider import FakeScriptModelProvider
from backend.app.services.task_service import TaskService
from backend.tests.test_validators import VALID_SCRIPT
from langgraph.types import Command


def request(max_retries: int = 2) -> ScriptTaskCreate:
    return ScriptTaskCreate(
        project_id="project-1",
        episode_id="episode-1",
        episode_number=1,
        episode_outline="林夏在档案室发现秘密，并接到神秘电话。",
        character_context="林夏：谨慎的调查员",
        world_context="现代都市悬疑",
        previous_episode_summary="",
        user_requirements="结尾出现电话",
        target_words=300,
        max_retries=max_retries,
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
        issues=[] if passed else ["结尾钩子不足"],
        revision_instructions=[] if passed else ["强化结尾电话钩子"],
    )


def build_service(tmp_path, provider, checkpointer=None):
    settings = Settings(
        database_path=tmp_path / "tasks.sqlite3",
        checkpoint_path=tmp_path / "checkpoints.sqlite3",
        max_concurrent_tasks=2,
    )
    database = Database(settings.database_path)
    database.initialize()
    return TaskService(
        settings,
        TaskRepository(database),
        VersionRepository(database),
        provider,
        checkpointer or InMemorySaver(),
    )


def wait_for(service: TaskService, task_id: str, status: TaskStatus, timeout: float = 3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = service.get_task(task_id)
        if task.status is status:
            return task
        time.sleep(0.02)
    raise AssertionError(f"task {task_id} did not reach {status}: {service.get_task(task_id).status}")


def test_create_runs_in_background_and_persists_review_draft(tmp_path):
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    service = build_service(tmp_path, provider)
    try:
        created = service.create_task(request())
        assert created.status is TaskStatus.QUEUED

        paused = wait_for(service, created.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)

        assert paused.script_content == VALID_SCRIPT
        assert service.list_versions(created.task_id)[0].approved is False
    finally:
        service.shutdown()


def test_recovery_uses_existing_draft_without_repeating_generation(tmp_path):
    first_provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    first = build_service(tmp_path, first_provider)
    task = first.tasks.create(request(), task_id="recover-task")
    first.versions.append(task.task_id, VALID_SCRIPT, source="model", approved=False, idempotency_key="draft-existing")
    first.tasks.update(task.task_id, status=TaskStatus.RUNNING, script_content=VALID_SCRIPT)
    first.shutdown()

    second_provider = FakeScriptModelProvider()
    second = build_service(tmp_path, second_provider)
    try:
        second.recover_pending()
        recovered = wait_for(second, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        assert recovered.script_content == VALID_SCRIPT
        assert second_provider.calls == []
    finally:
        second.shutdown()


def test_cancellation_after_provider_return_prevents_later_nodes(tmp_path):
    started = Event()
    release = Event()

    class BlockingProvider(FakeScriptModelProvider):
        def generate_script(self, task_request):
            started.set()
            release.wait(2)
            return super().generate_script(task_request)

    provider = BlockingProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    service = build_service(tmp_path, provider)
    try:
        task = service.create_task(request())
        assert started.wait(1)
        service.cancel(task.task_id)
        release.set()

        cancelled = wait_for(service, task.task_id, TaskStatus.CANCELLED)
        assert cancelled.script_content == ""
        assert [call.operation for call in provider.calls] == ["generate"]
    finally:
        release.set()
        service.shutdown()


def test_accept_review_is_idempotent_and_creates_one_approved_version(tmp_path):
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    service = build_service(tmp_path, provider)
    try:
        task = service.create_task(request())
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        review = ReviewRequest(action=ReviewAction.ACCEPT, idempotency_key="approve-once")
        service.submit_review(task.task_id, review)
        completed = wait_for(service, task.task_id, TaskStatus.COMPLETED)
        service.submit_review(task.task_id, review)

        versions = service.list_versions(task.task_id)
        assert completed.final_approved is True
        assert len([version for version in versions if version.approved]) == 1
    finally:
        service.shutdown()


def test_accept_review_without_explicit_key_is_idempotent_after_completion(tmp_path):
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    service = build_service(tmp_path, provider)
    try:
        task = service.create_task(request())
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        review = ReviewRequest(action=ReviewAction.ACCEPT)
        service.submit_review(task.task_id, review)
        wait_for(service, task.task_id, TaskStatus.COMPLETED)

        repeated = service.submit_review(task.task_id, review)

        assert repeated.status is TaskStatus.COMPLETED
        assert len([version for version in service.list_versions(task.task_id) if version.approved]) == 1
    finally:
        service.shutdown()


def test_duplicate_in_flight_review_is_idempotent(tmp_path):
    provider = FakeScriptModelProvider(
        script_results=[VALID_SCRIPT, VALID_SCRIPT + "\nAction: stronger ending."],
        review_results=[quality(False), quality(True)],
    )
    service = build_service(tmp_path, provider)
    try:
        task = service.create_task(request(max_retries=0))
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        review = ReviewRequest(
            action=ReviewAction.REQUEST_REVISION,
            feedback="Strengthen the ending",
            idempotency_key="revise-once",
        )

        first = service.submit_review(task.task_id, review)
        second = service.submit_review(task.task_id, review)
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)

        assert first.task_id == second.task_id
        assert [call.operation for call in provider.calls] == ["generate", "review", "revise", "review"]
    finally:
        service.shutdown()


def test_recovery_resumes_persisted_pending_accept(tmp_path):
    checkpointer = InMemorySaver()
    first_provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    first = build_service(tmp_path, first_provider, checkpointer)
    task = first.create_task(request())
    wait_for(first, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
    first.shutdown()
    first.tasks.update(
        task.task_id,
        status=TaskStatus.RUNNING,
        pending_review_action=ReviewAction.ACCEPT.value,
        pending_review_idempotency_key="recover-accept",
    )

    second = build_service(tmp_path, FakeScriptModelProvider(), checkpointer)
    try:
        second.recover_pending()
        completed = wait_for(second, task.task_id, TaskStatus.COMPLETED)

        assert completed.final_approved is True
        assert second.list_versions(task.task_id)[-1].idempotency_key == "recover-accept"
    finally:
        second.shutdown()


def test_review_resume_does_not_publish_stale_waiting_state(tmp_path):
    provider = FakeScriptModelProvider(
        script_results=[VALID_SCRIPT, VALID_SCRIPT + "\nAction: the phone rings again."],
        review_results=[quality(False), quality(True)],
    )
    service = build_service(tmp_path, provider)
    stale_state_seen = Event()
    release_resume = Event()

    class DelayedResumeGraph:
        def __init__(self, graph):
            self.graph = graph

        def get_state(self, config):
            return self.graph.get_state(config)

        def stream(self, graph_input, *, config, stream_mode):
            if isinstance(graph_input, Command):
                snapshot = self.graph.get_state(config)
                yield dict(snapshot.values)
                stale_state_seen.set()
                release_resume.wait(2)
            yield from self.graph.stream(graph_input, config=config, stream_mode=stream_mode)

    try:
        task = service.create_task(request(max_retries=0))
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        service.graph = DelayedResumeGraph(service.graph)

        service.submit_review(
            task.task_id,
            ReviewRequest(action=ReviewAction.REQUEST_REVISION, feedback="Strengthen the final hook"),
        )
        assert stale_state_seen.wait(1)
        assert service.get_task(task.task_id).status is TaskStatus.RUNNING
    finally:
        release_resume.set()
        service.shutdown()


def test_edited_accept_and_human_requested_revision(tmp_path):
    provider = FakeScriptModelProvider(
        script_results=[VALID_SCRIPT, VALID_SCRIPT + "\n动作：神秘电话再次响起。"],
        review_results=[quality(False), quality(True)],
    )
    service = build_service(tmp_path, provider)
    try:
        task = service.create_task(request(max_retries=0))
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        service.submit_review(
            task.task_id,
            ReviewRequest(action=ReviewAction.REQUEST_REVISION, feedback="电话钩子再强一点"),
        )
        wait_for(service, task.task_id, TaskStatus.AWAITING_HUMAN_REVIEW)
        edited = VALID_SCRIPT + "\n动作：用户补充终场。"
        service.submit_review(
            task.task_id,
            ReviewRequest(action=ReviewAction.EDIT_ACCEPT, edited_content=edited, idempotency_key="edited-final"),
        )
        completed = wait_for(service, task.task_id, TaskStatus.COMPLETED)

        assert completed.script_content == edited
        assert service.list_versions(task.task_id)[-1].source == "human"
        assert [call.operation for call in provider.calls] == ["generate", "review", "revise", "review"]
    finally:
        service.shutdown()
