import uuid 
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

from docker.errors import NotFound

from app.core.config import settings
from app.infra.docker_gateway import DockerGateway

MANAGED_BY_LABEL = "vscode-web-env-manager"

class EnvironmentNotFoundError(Exception):
    pass

class EnvironmentService:
    def __init__(self, docker_gateway: DockerGateway) -> None:
        self.docker = docker_gateway
    
    def create_environment(self, mount_folder: str) -> dict:
        env_id = uuid.uuid4().hex[:12]
        container_name = self._container_name(env_id)
        workspace_path = self._resolve_workspace_path(mount_folder)

        workspace_path.mkdir(parents=True, exist_ok=True)

        container = self.docker.run_container(
            image=settings.openvscode_image,
            name=container_name,
            network=settings.env_network,
            labels={
                "managed-by": MANAGED_BY_LABEL,
                "env-id": env_id,
                "mount-folder": mount_folder,
            },
            volumes={
                str(workspace_path): {
                    "bind": "/home/workspace",
                    "mode": "rw"
                }
            }
        )

        container.reload()

        return {
            "id": env_id,
            "container_name": container_name,
            "status": container.status,
            "url": self._build_environment_url(container_name),
            "workspace_path": str(workspace_path),
        }
    
    def list_environments(self) -> list[dict]:
        environments = []

        for container in self.docker.list_managed_containers():
            container.reload()
            labels = container.labels

            environments.append(
                {
                    "id": labels.get("env-id", "unknown"),
                    "container_name": container.name,
                    "status": container.status,
                    "url": self._build_environment_url(container.name),
                    "mount_folder": labels.get("mount-folder", "unknown")
                }
            )

        return environments

    def get_environment(self, env_id: str) -> dict:
        container = self._get_environment_container(env_id)
        attrs = self.docker.inspect_container(container)

        return {
            "id": env_id,
            "container_name": container.name,
            "status": container.status,
            "image": attrs["Config"]["Image"],
            "labels": container.labels,
            "mounts": attrs["Mounts"],
            "networks": attrs["NetworkSettings"]["Networks"],
        }
    
    def stop_environment(self, env_id: str) -> dict:
        container = self._get_environment_container(env_id)
        self.docker.stop_container(container)
        container.reload()

        return {
            "id": env_id,
            "container_name": container.name,
            "status": container.status,
        }
    
    def stop_all_environments(self) -> dict:
        stopped_environments = []
        failed_environments = []

        for container in self.docker.list_managed_containers():
            container.reload()
            labels = container.labels
            env_id = labels.get("env-id", "unknown")

            if container.status != "running":
                stopped_environments.append(
                    {
                        "id": env_id,
                        "container_name": container.name,
                        "previous_status": container.status,
                        "status": container.status,
                        "skipped": True,
                    }
                )
                continue

            try:
                self.docker.stop_container(container)
                container.reload()

                stopped_environments.append(
                    {
                        "id": env_id,
                        "container_name": container.name,
                        "previous_status": "running",
                        "status": container.status,
                        "skipped": False,
                    }
                )

            except Exception as exc:
                failed_environments.append(
                    {
                        "id": env_id,
                        "container_name": container.name,
                        "error": str(exc),
                    }
                )

        return {
            "stopped_count": len(
                [environment for environment in stopped_environments if not environment["skipped"]]
            ),
            "skipped_count": len(
                [environment for environment in stopped_environments if environment["skipped"]]
            ),
            "failed_count": len(failed_environments),
            "environments": stopped_environments,
            "failures": failed_environments,
        }
    
    def remove_environment(self, env_id: str) -> dict:
        container = self._get_environment_container(env_id)
        self.docker.remove_container(container)

        return {
            "id": env_id,
            "removed": True,
        }

    def _get_environment_container(self, env_id: str):
        try:
            return self.docker.get_container(self._container_name(env_id))
        except NotFound as exc:
            raise EnvironmentNotFoundError("Environment not found") from exc
        
    def _container_name(self, env_id: str) -> str:
        return f"vscode-env-{env_id}"
    
    def _resolve_workspace_path(self, mount_folder: str) -> Path:
        root = Path(settings.host_workspaces_root).resolve()
        target = (root / mount_folder).resolve()

        if target != root and root not in target.parents:
            raise ValueError("mount_folder must stay inside the configured workspaces root")
        
        return target
    
    def _build_environment_url(self, container_name: str) -> str:
        parsed_url = urlsplit(settings.public_base_url)

        if parsed_url.hostname is None:
            raise ValueError("PUBLIC_BASE_URL must include a valid hostname")

        host = f"{container_name}.{parsed_url.hostname}"

        netloc = host
        if parsed_url.port is not None:
            netloc = f"{host}:{parsed_url.port}"

        query = urlencode({"folder": "/home/workspace"})

        return urlunsplit((
            parsed_url.scheme,
            netloc,
            "/",
            query,
            "",
        ))