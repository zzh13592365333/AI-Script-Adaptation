from contextlib import asynccontextmanager
from pathlib import Path
import sqlite3

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.sqlite import SqliteSaver

from backend.app.api.health import router as health_router
from backend.app.api.openai_proxy import router as openai_proxy_router
from backend.app.api.script_tasks import router as script_tasks_router
from backend.app.api.stage_reviews import router as stage_reviews_router
from backend.app.core.config import Settings, get_settings
from backend.app.repositories.database import Database
from backend.app.repositories.task_repository import TaskRepository
from backend.app.repositories.version_repository import VersionRepository
from backend.app.services.model_provider import FakeScriptModelProvider, ModelProviderError, OpenAICompatibleProvider, ScriptModelProvider
from backend.app.services.task_service import TaskService
from backend.app.workflows.stage_review_graph import build_stage_review_graph


def create_app(
    settings: Settings | None = None,
    task_service: TaskService | None = None,
    stage_review_provider: ScriptModelProvider | None = None,
) -> FastAPI:
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if task_service is not None:
            app.state.task_service = task_service
            if stage_review_provider is not None:
                app.state.stage_review_graph = build_stage_review_graph(stage_review_provider)
            yield
            return
        Path(runtime_settings.checkpoint_path).parent.mkdir(parents=True, exist_ok=True)
        database = Database(runtime_settings.database_path)
        database.initialize()
        checkpoint_connection = sqlite3.connect(runtime_settings.checkpoint_path, check_same_thread=False)
        checkpointer = SqliteSaver(checkpoint_connection)
        try:
            try:
                provider = stage_review_provider or OpenAICompatibleProvider(runtime_settings)
            except ModelProviderError as error:
                provider = FakeScriptModelProvider(failures={"generate": error, "review": error, "revise": error})
            service = TaskService(
                runtime_settings,
                TaskRepository(database),
                VersionRepository(database),
                provider,
                checkpointer,
            )
            app.state.task_service = service
            app.state.stage_review_graph = build_stage_review_graph(provider)
            service.recover_pending()
            yield
        finally:
            service = getattr(app.state, "task_service", None)
            if service is not None:
                service.shutdown()
            checkpoint_connection.close()

    app = FastAPI(title="AI Comic Workflow Backend", version="0.1.0", lifespan=lifespan)
    app.state.settings = runtime_settings
    if task_service is not None:
        app.state.task_service = task_service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    app.include_router(openai_proxy_router, prefix="/api")
    app.include_router(script_tasks_router, prefix="/api")
    app.include_router(stage_reviews_router, prefix="/api")
    return app


app = create_app()
