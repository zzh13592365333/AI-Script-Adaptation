from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_path: Path = Path("backend/data/tasks.sqlite3")
    checkpoint_path: Path = Path("backend/data/checkpoints.sqlite3")
    model_base_url: str = ""
    model_api_key: str = ""
    model_name: str = ""
    model_reasoning_effort: str = "low"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://127.0.0.1:4173", "http://localhost:4173"]
    )
    max_concurrent_tasks: int = Field(default=2, ge=1, le=8)
    max_input_chars: int = Field(default=180_000, ge=1_000, le=1_000_000)
    default_max_retries: int = Field(default=2, ge=0, le=5)

    @property
    def model_configured(self) -> bool:
        return bool(self.model_base_url and self.model_api_key and self.model_name)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
