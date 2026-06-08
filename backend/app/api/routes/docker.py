from fastapi import APIRouter, HTTPException

from app.infra.docker_gateway import DockerGateway

router = APIRouter(prefix="/docker", tags=["docker"])

@router.get("/info")
def docker_info() -> dict:
    try:
        gateway = DockerGateway()
        info = gateway.docker_info()

        return {
            "docker": "connected",
            "server_version": info.get("ServerVersion"),
            "containers": info.get("Containers"),
            "images": info.get("Images"),
        }
    
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc