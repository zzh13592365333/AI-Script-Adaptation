from datetime import UTC, datetime
import sqlite3

from backend.app.models.script_task import ScriptVersion
from backend.app.repositories.database import Database


class DuplicateVersionError(ValueError):
    pass


class VersionRepository:
    def __init__(self, database: Database):
        self.database = database

    def append(
        self,
        task_id: str,
        content: str,
        *,
        source: str,
        approved: bool,
        idempotency_key: str,
    ) -> ScriptVersion:
        created_at = datetime.now(UTC)
        try:
            with self.database.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM script_versions WHERE task_id = ?",
                    (task_id,),
                ).fetchone()
                version = int(row["next_version"])
                connection.execute(
                    """INSERT INTO script_versions
                       (task_id, version, content, source, approved, idempotency_key, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (task_id, version, content, source, int(approved), idempotency_key, created_at.isoformat()),
                )
        except sqlite3.IntegrityError as error:
            if "idempotency_key" in str(error) or "UNIQUE" in str(error):
                raise DuplicateVersionError(idempotency_key) from error
            raise
        return ScriptVersion(
            task_id=task_id,
            version=version,
            content=content,
            source=source,
            approved=approved,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )

    def list_for_task(self, task_id: str) -> list[ScriptVersion]:
        with self.database.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM script_versions WHERE task_id = ? ORDER BY version", (task_id,)
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def latest(self, task_id: str) -> ScriptVersion | None:
        with self.database.connection() as connection:
            row = connection.execute(
                "SELECT * FROM script_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1", (task_id,)
            ).fetchone()
        return self._from_row(row) if row else None

    @staticmethod
    def _from_row(row) -> ScriptVersion:
        return ScriptVersion(
            task_id=row["task_id"],
            version=row["version"],
            content=row["content"],
            source=row["source"],
            approved=bool(row["approved"]),
            idempotency_key=row["idempotency_key"],
            created_at=row["created_at"],
        )
