from functools import lru_cache
from typing import Any

import docker
from docker.errors import ImageNotFound
from docker.models.containers import Container

DEFAULT_RESTART_POLICY: dict[str, str] = {"Name": "unless-stopped"}


class DockerGateway:
    def __init__(self) -> None:
        self.client = docker.from_env()

    def ping(self) -> bool:
        return self.client.ping()

    def docker_info(self) -> dict[str, Any]:
        return self.client.info()

    def ensure_image_exists(self, image: str) -> None:
        try:
            self.client.images.get(image)
        except ImageNotFound:
            self.client.images.pull(image)

    def run_container(
        self,
        *,
        image: str,
        name: str,
        network: str,
        labels: dict[str, str],
        volumes: dict[str, dict[str, str]],
        restart_policy: dict[str, str] | None = None,
    ) -> Container:
        self.ensure_image_exists(image)

        return self.client.containers.run(
            image=image,
            name=name,
            detach=True,
            network=network,
            labels=labels,
            volumes=volumes,
            restart_policy=restart_policy or DEFAULT_RESTART_POLICY,
        )

    def list_managed_containers(self) -> list[Container]:
        return self.client.containers.list(
            all=True,
            filters={"label": "managed-by=vscode-web-env-manager"},
        )

    def get_container(self, name: str) -> Container:
        return self.client.containers.get(name)

    def inspect_container(self, container: Container) -> dict[str, Any]:
        container.reload()
        return container.attrs

    def start_container(self, container: Container) -> None:
        container.start()

    def stop_container(self, container: Container) -> None:
        container.stop()

    def remove_container(self, container: Container) -> None:
        container.remove(force=True)


@lru_cache(maxsize=1)
def get_docker_gateway() -> DockerGateway:
    return DockerGateway()
