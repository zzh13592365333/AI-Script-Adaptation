from fastapi import APIRouter, HTTPException, Request, status

from backend.app.models.review import ReviewRequest
from backend.app.models.script_task import ScriptTaskCreate, ScriptTaskResponse, ScriptVersion
from backend.app.services.task_service import (
    InputLimitError,
    InvalidTaskTransitionError,
    TaskNotFoundError,
    TaskService,
)


router = APIRouter(prefix="/script-tasks", tags=["script-tasks"])


def service_for(request: Request) -> TaskService:
    service = getattr(request.app.state, "task_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="剧本工作流服务尚未启动")
    return service


def handle_error(error: Exception):
    if isinstance(error, TaskNotFoundError):
        raise HTTPException(status_code=404, detail="任务不存在") from error
    if isinstance(error, InvalidTaskTransitionError):
        raise HTTPException(status_code=409, detail=str(error)) from error
    if isinstance(error, InputLimitError):
        raise HTTPException(status_code=422, detail=str(error)) from error
    raise error


@router.post("", response_model=ScriptTaskResponse, status_code=status.HTTP_202_ACCEPTED)
def create_script_task(payload: ScriptTaskCreate, request: Request):
    service = service_for(request)
    try:
        return service.to_response(service.create_task(payload))
    except Exception as error:
        handle_error(error)


@router.get("/{task_id}", response_model=ScriptTaskResponse)
def get_script_task(task_id: str, request: Request):
    service = service_for(request)
    try:
        return service.to_response(service.get_task(task_id))
    except Exception as error:
        handle_error(error)


@router.get("/{task_id}/result", response_model=ScriptTaskResponse)
def get_script_result(task_id: str, request: Request):
    service = service_for(request)
    try:
        return service.to_response(service.get_result(task_id))
    except Exception as error:
        handle_error(error)


@router.get("/{task_id}/versions", response_model=list[ScriptVersion])
def get_script_versions(task_id: str, request: Request):
    service = service_for(request)
    try:
        return service.list_versions(task_id)
    except Exception as error:
        handle_error(error)


@router.post("/{task_id}/review", response_model=ScriptTaskResponse, status_code=status.HTTP_202_ACCEPTED)
def review_script_task(task_id: str, payload: ReviewRequest, request: Request):
    service = service_for(request)
    try:
        return service.to_response(service.submit_review(task_id, payload))
    except Exception as error:
        handle_error(error)


@router.post("/{task_id}/regenerate", response_model=ScriptTaskResponse, status_code=status.HTTP_202_ACCEPTED)
def regenerate_script_task(task_id: str, payload: dict[str, str], request: Request):
    service = service_for(request)
    feedback = payload.get("feedback", "").strip()
    if not feedback:
        raise HTTPException(status_code=422, detail="重新生成必须提供反馈")
    try:
        return service.to_response(service.regenerate(task_id, feedback))
    except Exception as error:
        handle_error(error)


@router.post("/{task_id}/cancel", response_model=ScriptTaskResponse, status_code=status.HTTP_202_ACCEPTED)
def cancel_script_task(task_id: str, request: Request):
    service = service_for(request)
    try:
        return service.to_response(service.cancel(task_id))
    except Exception as error:
        handle_error(error)
