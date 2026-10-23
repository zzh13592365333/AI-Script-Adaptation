from collections.abc import Iterable
from datetime import UTC, datetime
import json
from uuid import uuid4

from backend.app.models.script_task import ScriptTaskCreate, ScriptTaskRecord, TaskStage, TaskStatus
from backend.app.repositories.database import Database


class TaskRepository:
    def __init__(self, database: Database):
        self.database = database

    def create(self, request: ScriptTaskCreate, task_id: str | None = None) -> ScriptTaskRecord:
        record = ScriptTaskRecord.from_create(task_id or str(uuid4()), request)
        with self.database.connection() as connection:
            self._insert(connection, record)
        return record

    def get(self, task_id: str) -> ScriptTaskRecord | None:
        with self.database.connection() as connection:
            row = connection.execute(
                "SELECT payload_json FROM script_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
        return self._from_row(row)

    def update(self, task_id: str, **changes) -> ScriptTaskRecord:
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT payload_json FROM script_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
            record = self._from_row(row)
            if record is None:
                raise KeyError(task_id)
            changes["updated_at"] = datetime.now(UTC)
            updated = record.model_copy(update=changes)
            self._update_row(connection, updated)
        return updated

    def claim(
        self,
        task_id: str,
        expected_statuses: set[TaskStatus],
        new_status: TaskStatus,
        new_stage: TaskStage,
    ) -> bool:
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT payload_json FROM script_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
            record = self._from_row(row)
            if record is None or record.status not in expected_statuses or record.cancellation_requested:
                return False
            updated = record.model_copy(
                update={
                    "status": new_status,
                    "current_stage": new_stage,
                    "updated_at": datetime.now(UTC),
                }
            )
            self._update_row(connection, updated)
            return True

    def transition(
        self,
        task_id: str,
        expected_statuses: set[TaskStatus],
        **changes,
    ) -> ScriptTaskRecord | None:
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT payload_json FROM script_tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
            record = self._from_row(row)
            if record is None or record.status not in expected_statuses or record.cancellation_requested:
                return None
            changes["updated_at"] = datetime.now(UTC)
            updated = record.model_copy(update=changes)
            self._update_row(connection, updated)
            return updated

    def cancel(self, task_id: str) -> bool:
        record = self.get(task_id)
        if record is None or record.status in {TaskStatus.COMPLETED, TaskStatus.CANCELLED}:
            return False
        self.update(task_id, cancellation_requested=True)
        return True

    def list_recoverable(self) -> list[ScriptTaskRecord]:
        recoverable = (TaskStatus.QUEUED.value, TaskStatus.RUNNING.value, TaskStatus.QUALITY_FAILED.value)
        placeholders = ",".join("?" for _ in recoverable)
        with self.database.connection() as connection:
            rows = connection.execute(
                f"""SELECT payload_json FROM script_tasks
                    WHERE status IN ({placeholders}) AND cancellation_requested = 0
                    ORDER BY created_at, task_id""".replace("created_at", "updated_at"),
                recoverable,
            ).fetchall()
        return [record for row in rows if (record := self._from_row(row)) is not None]

    def list_by_status(self, statuses: Iterable[TaskStatus]) -> list[ScriptTaskRecord]:
        values = tuple(status.value for status in statuses)
        if not values:
            return []
        placeholders = ",".join("?" for _ in values)
        with self.database.connection() as connection:
            rows = connection.execute(
                f"SELECT payload_json FROM script_tasks WHERE status IN ({placeholders}) ORDER BY updated_at",
                values,
            ).fetchall()
        return [record for row in rows if (record := self._from_row(row)) is not None]

    @staticmethod
    def _from_row(row) -> ScriptTaskRecord | None:
        if row is None:
            return None
        return ScriptTaskRecord.model_validate_json(row["payload_json"])

    @staticmethod
    def _insert(connection, record: ScriptTaskRecord) -> None:
        connection.execute(
            """INSERT INTO script_tasks
                (task_id, status, current_stage, cancellation_requested, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)""",
            (
                record.task_id,
                record.status.value,
                record.current_stage.value,
                int(record.cancellation_requested),
                record.updated_at.isoformat(),
                record.model_dump_json(),
            ),
        )

    @staticmethod
    def _update_row(connection, record: ScriptTaskRecord) -> None:
        connection.execute(
            """UPDATE script_tasks
               SET status = ?, current_stage = ?, cancellation_requested = ?, updated_at = ?, payload_json = ?
               WHERE task_id = ?""",
            (
                record.status.value,
                record.current_stage.value,
                int(record.cancellation_requested),
                record.updated_at.isoformat(),
                record.model_dump_json(),
                record.task_id,
            ),
        )
