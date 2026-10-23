from fastapi import APIRouter, HTTPException, Request

from backend.app.models.stage_review import (
    StageReviewRequest,
    StageReviewResult,
    StageRevisionRequest,
    StageRevisionResult,
)
from backend.app.services.model_provider import ModelProviderError


router = APIRouter(prefix="/stage-reviews", tags=["stage-reviews"])


def graph_for(request: Request):
    graph = getattr(request.app.state, "stage_review_graph", None)
    if graph is None:
        raise HTTPException(status_code=503, detail="阶段审核服务尚未启动")
    return graph


@router.post("/check", response_model=StageReviewResult)
def check_stage(payload: StageReviewRequest, request: Request):
    try:
        state = graph_for(request).invoke({"operation": "check", "review_request": payload.model_dump(mode="json")})
        return StageReviewResult.model_validate(state["review_result"])
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail=error.public_message) from error


@router.post("/revise", response_model=StageRevisionResult)
def revise_stage(payload: StageRevisionRequest, request: Request):
    try:
        state = graph_for(request).invoke({"operation": "revise", "revision_request": payload.model_dump(mode="json")})
        return StageRevisionResult.model_validate(state["revision_result"])
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail=error.public_message) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
