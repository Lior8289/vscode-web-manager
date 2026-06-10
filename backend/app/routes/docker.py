from typing import Annotated

from docker.errors import DockerException
from fastapi import APIRouter, Depends, HTTPException

from app.docker_gateway import DockerGateway, get_docker_gateway

router = APIRouter(prefix="/docker", tags=["docker"])


@router.get("/info")
def docker_info(
    gateway: Annotated[DockerGateway, Depends(get_docker_gateway)],
) -> dict:
    try:
        info = gateway.docker_info()
    except DockerException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "docker": "connected",
        "server_version": info.get("ServerVersion"),
        "containers": info.get("Containers"),
        "images": info.get("Images"),
    }
