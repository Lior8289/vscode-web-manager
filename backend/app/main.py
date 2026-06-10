from fastapi import FastAPI

from app.routes.docker import router as docker_router
from app.routes.environments import router as environments_router
from app.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="VS Code Environment Manager")

    app.include_router(health_router)
    app.include_router(docker_router)
    app.include_router(environments_router)

    return app

app = create_app()