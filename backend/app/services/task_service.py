from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from threading import Lock
from typing import Any

from langgraph.types import Command

from backend.app.core.config import Settings
from backend.app.models.review import ReviewAction, ReviewRequest
from backend.app.models.script_task import (
    QualityCheckResult,
    ScriptTaskCreate,
    ScriptTaskRecord,
    ScriptTaskResponse,
    ScriptVersion,
    TaskStage,
    TaskStatus,
)
from backend.app.repositories.task_repository import TaskRepository
from backend.app.repositories.version_repository import DuplicateVersionError, VersionRepository
from backend.app.services.model_provider import ScriptModelProvider
from backend.app.workflows.script_graph import build_script_graph, initial_workflow_state


class TaskNotFoundError(KeyError):
    pass


class InvalidTaskTransitionError(RuntimeError):
    pass


class InputLimitError(ValueError):
    pass


class TaskService:
    def __init__(
        self,
        settings: Settings,
        tasks: TaskRepository,
        versions: VersionRepository,
        provider: ScriptModelProvider,
        checkpointer,
    ):
        self.settings = settings
        self.tasks = tasks
        self.versions = versions
        self.provider = provider
        self.checkpointer = checkpointer
        self.graph = build_script_graph(provider, checkpointer, self._is_cancelled)
        self.executor = ThreadPoolExecutor(
            max_workers=settings.max_concurrent_tasks,
            thread_name_prefix="script-workflow",
        )
        self._shutdown_lock = Lock()
        self._closed = False

    def create_task(self, request: ScriptTaskCreate) -> ScriptTaskRecord:
        self.validate_request(request)
        record = self.tasks.create(request)
        self.executor.submit(self._run_task, record.task_id)
        return record

    def validate_request(self, request: ScriptTaskCreate) -> None:
        total = sum(
            len(value)
            for value in (
                request.episode_outline,
                request.character_context,
                request.world_context,
                request.previous_episode_summary,
                request.user_requirements,
            )
        )
        if total > self.settings.max_input_chars:
            raise InputLimitError(f"输入上下文超过 {self.settings.max_input_chars} 字符限制")

    def get_task(self, task_id: str) -> ScriptTaskRecord:
        task = self.tasks.get(task_id)
        if task is None:
            raise TaskNotFoundError(task_id)
        return task

    def get_result(self, task_id: str) -> ScriptTaskRecord:
        return self.get_task(task_id)

    def list_versions(self, task_id: str) -> list[ScriptVersion]:
        self.get_task(task_id)
        return self.versions.list_for_task(task_id)

    def submit_review(self, task_id: str, review: ReviewRequest) -> ScriptTaskRecord:
        task = self.get_task(task_id)
        review_version = task.version if task.status is TaskStatus.COMPLETED else task.version + 1
        idempotency_key = review.idempotency_key or f"review-{review_version}-{review.action.value}"
        latest = self.versions.latest(task_id)
        if task.status is TaskStatus.COMPLETED and latest and latest.idempotency_key == idempotency_key:
            return task
        if task.pending_review_idempotency_key == idempotency_key:
            return task
        updated = self.tasks.transition(
            task_id,
            {TaskStatus.AWAITING_HUMAN_REVIEW},
            status=TaskStatus.RUNNING,
            current_stage=TaskStage.REVISING if review.action is ReviewAction.REQUEST_REVISION else TaskStage.HUMAN_REVIEW,
            review_feedback=review.feedback,
            pending_review_action=review.action.value,
            pending_review_idempotency_key=idempotency_key,
            pending_review_edited_content=review.edited_content,
            error_code=None,
            error_message=None,
        )
        if updated is None:
            current = self.get_task(task_id)
            if current.pending_review_idempotency_key == idempotency_key:
                return current
            raise InvalidTaskTransitionError("任务当前不在人工审核阶段")
        self.executor.submit(self._resume_review, task_id, review, idempotency_key)
        return updated

    def regenerate(self, task_id: str, feedback: str) -> ScriptTaskRecord:
        return self.submit_review(
            task_id,
            ReviewRequest(action=ReviewAction.REQUEST_REVISION, feedback=feedback),
        )

    def cancel(self, task_id: str) -> ScriptTaskRecord:
        task = self.get_task(task_id)
        if not self.tasks.cancel(task_id):
            raise InvalidTaskTransitionError("任务已经结束，无法取消")
        if task.status is not TaskStatus.RUNNING:
            return self.tasks.update(
                task_id,
                status=TaskStatus.CANCELLED,
                current_stage=TaskStage.CANCELLED,
            )
        return self.get_task(task_id)

    def recover_pending(self) -> None:
        for task in self.tasks.list_recoverable():
            if task.pending_review_action and task.pending_review_idempotency_key:
                review = ReviewRequest(
                    action=ReviewAction(task.pending_review_action),
                    feedback=task.review_feedback,
                    edited_content=task.pending_review_edited_content,
                    idempotency_key=task.pending_review_idempotency_key,
                )
                self.executor.submit(
                    self._resume_review,
                    task.task_id,
                    review,
                    task.pending_review_idempotency_key,
                )
                continue
            latest = self.versions.latest(task.task_id)
            if latest and not latest.approved:
                self.tasks.update(
                    task.task_id,
                    script_content=latest.content,
                    version=latest.version,
                    status=TaskStatus.AWAITING_HUMAN_REVIEW,
                    current_stage=TaskStage.HUMAN_REVIEW,
                )
                continue
            self.executor.submit(self._run_task, task.task_id)

    def to_response(self, task: ScriptTaskRecord) -> ScriptTaskResponse:
        progress_by_stage = {
            TaskStage.QUEUED: 0,
            TaskStage.GENERATING: 20,
            TaskStage.VALIDATING: 45,
            TaskStage.REVIEWING: 65,
            TaskStage.REVISING: 75,
            TaskStage.HUMAN_REVIEW: 90,
            TaskStage.COMPLETED: 100,
            TaskStage.FAILED: 100,
            TaskStage.CANCELLED: 100,
        }
        return ScriptTaskResponse(
            **task.model_dump(),
            progress=progress_by_stage[task.current_stage],
        )

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._closed:
                return
            self._closed = True
            self.executor.shutdown(wait=True, cancel_futures=False)

    def _run_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        if task.cancellation_requested:
            self.tasks.update(task_id, status=TaskStatus.CANCELLED, current_stage=TaskStage.CANCELLED)
            return
        claimed = self.tasks.claim(
            task_id,
            {TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.QUALITY_FAILED},
            TaskStatus.RUNNING,
            TaskStage.GENERATING,
        )
        if not claimed:
            return
        config = self._config(task_id)
        snapshot = self.graph.get_state(config)
        graph_input = None if snapshot.values else initial_workflow_state(task_id, task)
        self._consume_graph(task_id, graph_input, config)

    def _resume_review(self, task_id: str, review: ReviewRequest, idempotency_key: str) -> None:
        decision = {
            "action": review.action.value,
            "feedback": review.feedback,
            "edited_content": review.edited_content,
        }
        final_state = self._consume_graph(
            task_id,
            Command(resume=decision),
            self._config(task_id),
            defer_completion=True,
        )
        if final_state.get("task_status") != TaskStatus.COMPLETED.value:
            self.tasks.update(
                task_id,
                pending_review_action=None,
                pending_review_idempotency_key=None,
                pending_review_edited_content="",
            )
            return
        content = str(final_state.get("script_content", ""))
        source = "human" if review.action is ReviewAction.EDIT_ACCEPT else "model"
        try:
            version = self.versions.append(
                task_id,
                content,
                source=source,
                approved=True,
                idempotency_key=idempotency_key,
            )
        except DuplicateVersionError:
            version = self.versions.latest(task_id)
        if version is not None:
            self.tasks.update(
                task_id,
                version=version.version,
                script_content=version.content,
                final_approved=True,
                status=TaskStatus.COMPLETED,
                current_stage=TaskStage.COMPLETED,
                pending_review_action=None,
                pending_review_idempotency_key=None,
                pending_review_edited_content="",
            )

    def _consume_graph(
        self,
        task_id: str,
        graph_input: Any,
        config: dict[str, Any],
        *,
        defer_completion: bool = False,
    ) -> dict[str, Any]:
        latest_state: dict[str, Any] = {}
        for state in self.graph.stream(graph_input, config=config, stream_mode="values"):
            latest_state = state
            self._sync_state(
                task_id,
                state,
                defer_completion=defer_completion,
                suppress_waiting=True,
            )
        snapshot = self.graph.get_state(config)
        if snapshot.values:
            latest_state = dict(snapshot.values)
            if latest_state.get("task_status") == TaskStatus.AWAITING_HUMAN_REVIEW.value:
                self._persist_draft(task_id, latest_state)
            self._sync_state(task_id, latest_state, defer_completion=defer_completion)
        return latest_state

    def _sync_state(
        self,
        task_id: str,
        state: dict[str, Any],
        *,
        defer_completion: bool = False,
        suppress_waiting: bool = False,
    ) -> ScriptTaskRecord:
        changes: dict[str, Any] = {}
        if "script_content" in state:
            changes["script_content"] = state["script_content"]
        if "review_feedback" in state:
            changes["review_feedback"] = state["review_feedback"]
        if "quality_check_result" in state:
            value = state["quality_check_result"]
            changes["quality_check_result"] = QualityCheckResult.model_validate(value) if value else None
        if "retry_count" in state:
            changes["retry_count"] = state["retry_count"]
        if "final_approved" in state:
            changes["final_approved"] = state["final_approved"]
        if "error_code" in state:
            changes["error_code"] = state["error_code"]
        if "error_message" in state:
            changes["error_message"] = state["error_message"]
        if "task_status" in state:
            status = TaskStatus(state["task_status"])
            if not (suppress_waiting and status is TaskStatus.AWAITING_HUMAN_REVIEW):
                changes["status"] = TaskStatus.RUNNING if defer_completion and status is TaskStatus.COMPLETED else status
        if "current_stage" in state:
            stage = TaskStage(state["current_stage"])
            if not (suppress_waiting and stage is TaskStage.HUMAN_REVIEW):
                changes["current_stage"] = TaskStage.HUMAN_REVIEW if defer_completion and stage is TaskStage.COMPLETED else stage
        return self.tasks.update(task_id, **changes) if changes else self.get_task(task_id)

    def _persist_draft(self, task_id: str, state: dict[str, Any]) -> None:
        content = str(state.get("script_content", ""))
        if not content.strip():
            return
        digest = sha256(content.encode("utf-8")).hexdigest()[:20]
        try:
            version = self.versions.append(
                task_id,
                content,
                source="model",
                approved=False,
                idempotency_key=f"draft-{digest}",
            )
        except DuplicateVersionError:
            version = self.versions.latest(task_id)
        if version is not None:
            self.tasks.update(task_id, version=version.version, script_content=version.content)

    def _is_cancelled(self, task_id: str) -> bool:
        task = self.tasks.get(task_id)
        return task is None or task.cancellation_requested

    @staticmethod
    def _config(task_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": task_id}}
