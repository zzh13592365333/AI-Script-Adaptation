from fastapi import APIRouter, Request


router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict[str, str | bool]:
    settings = request.app.state.settings
    return {
        "status": "ok",
        "service": "ai-comic-workflow-backend",
        "database": "sqlite",
        "model_configured": settings.model_configured,
    }
