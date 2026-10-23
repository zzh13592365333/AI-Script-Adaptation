from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
import sqlite3


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS script_tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    current_stage TEXT NOT NULL,
                    cancellation_requested INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_script_tasks_status
                    ON script_tasks(status, cancellation_requested, updated_at);

                CREATE TABLE IF NOT EXISTS script_versions (
                    task_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    source TEXT NOT NULL,
                    approved INTEGER NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (task_id, version),
                    UNIQUE (task_id, idempotency_key),
                    FOREIGN KEY (task_id) REFERENCES script_tasks(task_id) ON DELETE CASCADE
                );
                """
            )
