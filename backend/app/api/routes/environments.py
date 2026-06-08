from fastapi import APIRouter, HTTPException, status

from app.infra.docker_gateway import DockerGateway
from app.schemas.environment import CreateEnvironmentRequest
from app.services.environment_service import (EnvironmentNotFoundError, EnvironmentService)

router = APIRouter(prefix="/environments", tags=["environments"])

def get_environment_service() -> EnvironmentService:
    return EnvironmentService(DockerGateway())

@router.post("", status_code=status.HTTP_201_CREATED)
def create_environment(request: CreateEnvironmentRequest) -> dict:
    service = get_environment_service()

    try:
        return service.create_environment(request.mount_folder)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exd:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    
@router.get("")
def list_environments() -> list[dict]:
    service = get_environment_service()
    return service.list_environments()

@router.get("/{env_id}")
def get_environment(env_id: str) -> dict:
    service = get_environment_service()

    try:
        return service.get_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
@router.post("/{env_id}/stop")
def stop_environment(env_id: str) -> dict:
    service = get_environment_service()

    try:
        return service.stop_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
@router.delete("/{env_id}")
def remove_environment(env_id: str) -> dict:
    service = get_environment_service()

    try:
        return service.remove_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc