from typing import Annotated

from docker.errors import APIError, DockerException
from fastapi import APIRouter, Depends, HTTPException, status

from app.docker_gateway import DockerGateway, get_docker_gateway
from app.schemas import CreateEnvironmentRequest
from app.service import EnvironmentNotFoundError, EnvironmentService

router = APIRouter(prefix="/environments", tags=["environments"])


def get_environment_service(
    docker_gateway: Annotated[DockerGateway, Depends(get_docker_gateway)],
) -> EnvironmentService:
    return EnvironmentService(docker_gateway)


ServiceDep = Annotated[EnvironmentService, Depends(get_environment_service)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_environment(request: CreateEnvironmentRequest, service: ServiceDep) -> dict:
    try:
        return service.create_environment(request.mount_folder)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except APIError as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except DockerException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("")
def list_environments(service: ServiceDep) -> list[dict]:
    return service.list_environments()


@router.get("/{env_id}")
def get_environment(env_id: str, service: ServiceDep) -> dict:
    try:
        return service.get_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{env_id}/stop")
def stop_environment(env_id: str, service: ServiceDep) -> dict:
    try:
        return service.stop_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/stop-all")
def stop_all_environments(service: ServiceDep) -> dict:
    return service.stop_all_environments()


@router.delete("/{env_id}")
def remove_environment(env_id: str, service: ServiceDep) -> dict:
    try:
        return service.remove_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
