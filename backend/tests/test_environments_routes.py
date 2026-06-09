from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes.environments import get_environment_service
from app.main import app
from app.services.environment_service import EnvironmentNotFoundError


class FakeEnvironmentService:
    def __init__(self) -> None:
        self.create_raises: Exception | None = None
        self.get_raises: Exception | None = None
        self.stop_raises: Exception | None = None
        self.remove_raises: Exception | None = None

    def create_environment(self, mount_folder: str) -> dict[str, Any]:
        if self.create_raises is not None:
            raise self.create_raises
        return {
            "id": "abc123def456",
            "container_name": "vscode-env-abc123def456",
            "status": "running",
            "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
            "workspace_path": "/tmp/workspaces/demo",
            "reused": False,
        }

    def list_environments(self) -> list[dict[str, Any]]:
        return []

    def get_environment(self, env_id: str) -> dict[str, Any]:
        if self.get_raises is not None:
            raise self.get_raises
        return {"id": env_id, "container_name": f"vscode-env-{env_id}"}

    def stop_environment(self, env_id: str) -> dict[str, Any]:
        if self.stop_raises is not None:
            raise self.stop_raises
        return {"id": env_id, "container_name": f"vscode-env-{env_id}", "status": "exited"}

    def stop_all_environments(self) -> dict[str, Any]:
        return {
            "stopped_count": 0,
            "skipped_count": 0,
            "failed_count": 0,
            "environments": [],
            "failures": [],
        }

    def remove_environment(self, env_id: str) -> dict[str, Any]:
        if self.remove_raises is not None:
            raise self.remove_raises
        return {"id": env_id, "removed": True}


@pytest.fixture
def fake_service() -> FakeEnvironmentService:
    return FakeEnvironmentService()


@pytest.fixture
def client(fake_service: FakeEnvironmentService):
    app.dependency_overrides[get_environment_service] = lambda: fake_service
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_post_environments_returns_201(client):
    response = client.post("/environments", json={"mount_folder": "demo"})

    assert response.status_code == 201
    body = response.json()
    assert body["container_name"] == "vscode-env-abc123def456"
    assert body["reused"] is False


def test_post_environments_rejects_invalid_mount_folder(client):
    response = client.post("/environments", json={"mount_folder": "../etc"})

    assert response.status_code == 422


def test_post_environments_returns_400_on_value_error(client, fake_service):
    fake_service.create_raises = ValueError("mount_folder must stay inside the configured root")

    response = client.post("/environments", json={"mount_folder": "demo"})

    assert response.status_code == 400
    assert "must stay inside" in response.json()["detail"]


def test_get_environment_returns_404_when_not_found(client, fake_service):
    fake_service.get_raises = EnvironmentNotFoundError("Environment not found")

    response = client.get("/environments/missing00000")

    assert response.status_code == 404


def test_stop_environment_returns_404_when_not_found(client, fake_service):
    fake_service.stop_raises = EnvironmentNotFoundError("Environment not found")

    response = client.post("/environments/missing00000/stop")

    assert response.status_code == 404


def test_delete_environment_returns_404_when_not_found(client, fake_service):
    fake_service.remove_raises = EnvironmentNotFoundError("Environment not found")

    response = client.delete("/environments/missing00000")

    assert response.status_code == 404


def test_list_environments_returns_200_with_empty_list(client):
    response = client.get("/environments")

    assert response.status_code == 200
    assert response.json() == []
