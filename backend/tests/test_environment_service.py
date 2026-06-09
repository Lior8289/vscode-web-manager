from pathlib import Path

import pytest
from docker.errors import APIError, NotFound

from app.services.environment_service import (
    MANAGED_BY_LABEL,
    EnvironmentNotFoundError,
    EnvironmentService,
)


class FakeContainer:
    def __init__(
        self,
        *,
        name: str,
        labels: dict,
        status: str = "created",
        image: str = "test/openvscode:latest",
        network: str = "test-net",
        raise_on_start: bool = False,
        raise_on_stop: bool = False,
    ) -> None:
        self.name = name
        self.labels = dict(labels)
        self.status = status
        self.attrs = {
            "Config": {"Image": image},
            "Mounts": [],
            "NetworkSettings": {"Networks": {network: {}}},
        }
        self.raise_on_start = raise_on_start
        self.raise_on_stop = raise_on_stop

    def reload(self) -> None:
        pass

    def start(self) -> None:
        if self.raise_on_start:
            raise APIError("simulated start failure")
        self.status = "running"

    def stop(self) -> None:
        if self.raise_on_stop:
            raise APIError("simulated stop failure")
        self.status = "exited"


class FakeDockerGateway:
    def __init__(self) -> None:
        self.containers: dict[str, FakeContainer] = {}
        self.removed_names: list[str] = []
        self.run_container_calls: list[dict] = []

    def add(self, container: FakeContainer) -> FakeContainer:
        self.containers[container.name] = container
        return container

    def ensure_image_exists(self, image: str) -> None:
        pass

    def run_container(
        self,
        *,
        image: str,
        name: str,
        network: str,
        labels: dict,
        volumes: dict,
        restart_policy: dict | None = None,
    ) -> FakeContainer:
        self.run_container_calls.append(
            {
                "image": image,
                "name": name,
                "network": network,
                "labels": dict(labels),
                "volumes": dict(volumes),
                "restart_policy": restart_policy,
            }
        )
        container = FakeContainer(
            name=name,
            labels=labels,
            status="running",
            image=image,
            network=network,
        )
        self.containers[name] = container
        return container

    def list_managed_containers(self) -> list[FakeContainer]:
        return [
            container
            for container in self.containers.values()
            if container.labels.get("managed-by") == MANAGED_BY_LABEL
        ]

    def get_container(self, name: str) -> FakeContainer:
        if name not in self.containers:
            raise NotFound(f"container {name} not found")
        return self.containers[name]

    def inspect_container(self, container: FakeContainer) -> dict:
        container.reload()
        return container.attrs

    def start_container(self, container: FakeContainer) -> None:
        container.start()

    def stop_container(self, container: FakeContainer) -> None:
        container.stop()

    def remove_container(self, container: FakeContainer) -> None:
        if container.name in self.containers:
            del self.containers[container.name]
        self.removed_names.append(container.name)


@pytest.fixture
def gateway() -> FakeDockerGateway:
    return FakeDockerGateway()


@pytest.fixture
def service(gateway: FakeDockerGateway, test_settings) -> EnvironmentService:
    return EnvironmentService(gateway, wait_for_ready=lambda _: None)


def test_create_environment_returns_expected_shape(service, gateway, tmp_path):
    result = service.create_environment("demo")

    assert len(result["id"]) == 12
    assert result["container_name"] == f"vscode-env-{result['id']}"
    assert result["status"] == "running"
    assert result["reused"] is False
    assert Path(result["workspace_path"]) == (tmp_path / "demo").resolve()
    assert result["url"].startswith(f"http://{result['container_name']}.localhost:8080")
    assert "folder=" in result["url"]


def test_create_environment_passes_correct_labels_and_volumes(service, gateway, tmp_path):
    result = service.create_environment("demo")

    assert len(gateway.run_container_calls) == 1
    call = gateway.run_container_calls[0]
    assert call["image"] == "test/openvscode:latest"
    assert call["network"] == "test-net"
    assert call["labels"]["managed-by"] == MANAGED_BY_LABEL
    assert call["labels"]["env-id"] == result["id"]
    assert call["labels"]["mount-folder"] == "demo"

    workspace = str((tmp_path / "demo").resolve())
    assert call["volumes"][workspace] == {"bind": "/home/workspace", "mode": "rw"}


def test_create_environment_makes_workspace_directory(service, tmp_path):
    service.create_environment("demo")

    assert (tmp_path / "demo").is_dir()


def test_create_reuses_running_container_with_same_mount_folder(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-existing0001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "existing0001",
                "mount-folder": "demo",
            },
            status="running",
        )
    )

    result = service.create_environment("demo")

    assert result["reused"] is True
    assert result["id"] == "existing0001"
    assert gateway.run_container_calls == []


def test_create_restarts_stopped_container_with_same_mount_folder(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-stopped00001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "stopped00001",
                "mount-folder": "demo",
            },
            status="exited",
        )
    )

    result = service.create_environment("demo")

    assert result["reused"] is True
    assert result["status"] == "running"
    assert gateway.run_container_calls == []


def test_create_replaces_broken_container_when_start_fails(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-broken000001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "broken000001",
                "mount-folder": "demo",
            },
            status="exited",
            raise_on_start=True,
        )
    )

    result = service.create_environment("demo")

    assert "vscode-env-broken000001" in gateway.removed_names
    assert len(gateway.run_container_calls) == 1
    assert result["reused"] is False


@pytest.mark.parametrize(
    "mount_folder",
    ["..", "../etc", "subdir/../..", "/etc"],
)
def test_resolve_workspace_path_rejects_traversal(service, mount_folder):
    with pytest.raises(ValueError, match="must stay inside"):
        service._resolve_workspace_path(mount_folder)


def test_build_environment_url_with_port(service):
    url = service._build_environment_url("vscode-env-abc123def456")

    assert url.startswith("http://vscode-env-abc123def456.localhost:8080")
    assert "folder=%2Fhome%2Fworkspace" in url


def test_build_environment_url_without_port(service, monkeypatch, test_settings):
    monkeypatch.setattr(test_settings, "public_base_url", "https://demo.example.com")

    url = service._build_environment_url("vscode-env-abc123def456")

    assert url.startswith("https://vscode-env-abc123def456.demo.example.com")
    assert ":" not in url.split("//", 1)[1].split("?", 1)[0]


def test_get_environment_raises_not_found(service):
    with pytest.raises(EnvironmentNotFoundError):
        service.get_environment("missing00000")


def test_stop_environment_raises_not_found(service):
    with pytest.raises(EnvironmentNotFoundError):
        service.stop_environment("missing00000")


def test_remove_environment_raises_not_found(service):
    with pytest.raises(EnvironmentNotFoundError):
        service.remove_environment("missing00000")


def test_stop_all_skips_already_stopped(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-run000000001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "run000000001",
                "mount-folder": "a",
            },
            status="running",
        )
    )
    gateway.add(
        FakeContainer(
            name="vscode-env-stop00000001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "stop00000001",
                "mount-folder": "b",
            },
            status="exited",
        )
    )

    result = service.stop_all_environments()

    assert result["stopped_count"] == 1
    assert result["skipped_count"] == 1
    assert result["failed_count"] == 0


def test_stop_all_records_failures(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-fail00000001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "fail00000001",
                "mount-folder": "a",
            },
            status="running",
            raise_on_stop=True,
        )
    )

    result = service.stop_all_environments()

    assert result["failed_count"] == 1
    assert result["stopped_count"] == 0
    assert len(result["failures"]) == 1
    assert result["failures"][0]["id"] == "fail00000001"


def test_list_environments_only_returns_managed(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-managed00001",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "managed00001",
                "mount-folder": "demo",
            },
            status="running",
        )
    )
    gateway.add(
        FakeContainer(
            name="random-container",
            labels={"other": "label"},
            status="running",
        )
    )

    environments = service.list_environments()

    assert len(environments) == 1
    assert environments[0]["id"] == "managed00001"


def test_get_environment_returns_inspection_details(service, gateway):
    gateway.add(
        FakeContainer(
            name="vscode-env-detailsenv00",
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": "detailsenv00",
                "mount-folder": "demo",
            },
            status="running",
            image="test/openvscode:latest",
            network="test-net",
        )
    )

    details = service.get_environment("detailsenv00")

    assert details["id"] == "detailsenv00"
    assert details["image"] == "test/openvscode:latest"
    assert "test-net" in details["networks"]
    assert details["labels"]["mount-folder"] == "demo"
