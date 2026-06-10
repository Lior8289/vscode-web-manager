# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A FastAPI backend that spins up per-user `openvscode-server` containers on demand and exposes each one through an nginx subdomain. Cymotive home assignment.

## Common commands

All backend commands run from `backend/`.

```bash
# Setup (host-side dev loop)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# Run API locally (without Docker)
uvicorn app.main:app --reload --port 8000

# Lint (matches CI)
python -m ruff check .

# Tests
python -m pytest                              # full suite
python -m pytest tests/test_schemas.py        # one file
python -m pytest tests/test_schemas.py::test_create_environment_request_accepts_valid_mount_folder  # one test
python -m pytest -k mount_folder              # by keyword
```

From the repo root, the full stack runs via Docker Compose:

```bash
cp .env.example .env        # then edit HOST_WORKSPACES_ROOT to an absolute host path
docker compose up --build   # backend + nginx on http://localhost:8080
docker compose config       # validate compose file (CI runs this)
```

For reviewers who don't want to build (uses pre-built images from Docker Hub):

```bash
docker compose -f docker-compose.hub.yml up
```

`docker-compose.hub.yml` defaults every env var, including `HOST_WORKSPACES_ROOT=/tmp/vscode-web-manager-workspaces` (Docker auto-creates the dir on bind-mount). Override `HOST_WORKSPACES_ROOT` to persist workspaces across reboots.

## Architecture

Three runtime pieces wired together on a single Docker network (`manager-net`, name from `ENV_NETWORK`):

1. **Backend** (`backend/app/`) — FastAPI app exposing `/health`, `/docker/info`, and `/environments/*`. It talks to the host's Docker daemon via the mounted socket and creates/lists/stops/removes per-environment containers.
2. **nginx** (`deploy/nginx.conf`, baked into the frontend/nginx image) — Two virtual hosts on port 80:
   - `localhost` → proxies `/api/` to the backend and `/health` directly.
   - Regex host `~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$` → captures the container name from the subdomain and proxies to `http://$vscode_container:3000` with WebSocket upgrade. Relies on Docker's embedded DNS (`resolver 127.0.0.11`) to resolve the captured name.
3. **openvscode-server containers** — Launched by the backend with labels `managed-by=vscode-web-env-manager`, `env-id=<hex>`, `mount-folder=<name>`. Named `vscode-env-<12-hex>` so nginx's regex matches them.

### Backend layers

`main.py` builds the FastAPI app via `create_app()` and includes three routers. Below that, code is split by responsibility — keep this separation when adding features:

- `api/routes/` — thin HTTP handlers. They construct a service per request via `get_environment_service()` (no DI container; just `EnvironmentService(DockerGateway())`) and translate domain exceptions to `HTTPException`.
- `services/environment_service.py` — all environment lifecycle logic (create / list / get / stop / stop-all / remove, plus reuse-existing-by-mount-folder). Raises `EnvironmentNotFoundError` for 404 mapping in the route layer.
- `infra/docker_gateway.py` — only place that imports `docker`. Wraps the SDK so services never touch `docker.from_env()` directly. When adding Docker calls, extend `DockerGateway` rather than reaching into the SDK from services.
- `schemas/` — Pydantic request/response models. `CreateEnvironmentRequest.mount_folder` is regex-restricted to `^[a-zA-Z0-9_-]+$` (1–80 chars) — this is the first line of defense against path traversal; tests in `tests/test_schemas.py` lock that contract.
- `core/config.py` — `Settings` loaded from `.env` via `pydantic-settings`. Settings are read as a module-level `settings` singleton.

### Critical invariants

- **Container naming.** `EnvironmentService._container_name` produces `vscode-env-<env_id>` where `env_id = uuid.uuid4().hex[:12]`. nginx's regex `vscode-env-[a-f0-9]{12}` matches this exactly — if you change the name format, update both sides.
- **Workspace path safety.** `_resolve_workspace_path` resolves `host_workspaces_root / mount_folder` and rejects any path that escapes the root. The Pydantic pattern blocks slashes, dots, and traversal sequences at the edge; the resolved-path check is the defense in depth. Don't remove either.
- **Host-path passthrough.** `docker-compose.yml` mounts `${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}` so the path is identical inside and outside the backend container. The Docker socket call uses host paths (the daemon runs on the host), so the backend must address files by their host path. `HOST_WORKSPACES_ROOT` must be absolute.
- **Managed-by label.** `list_managed_containers()` filters by `label=managed-by=vscode-web-env-manager` (constant `MANAGED_BY_LABEL`). The backend never touches unlabeled containers — preserve that label on every `run_container` call.
- **Reuse semantics.** `create_environment` first looks for an existing container with the same `mount-folder` label; prefers a running one, otherwise starts a stopped one, otherwise removes a broken one and provisions fresh. The response includes a `reused: bool` flag.
- **Restart policy.** Backend, nginx, and every per-env container use `unless-stopped` (never `always`). `always` would resurrect a container after `POST /environments/{id}/stop`, turning the stop endpoint into a lie. Keep `unless-stopped` on every `run_container` call (`DEFAULT_RESTART_POLICY` in `docker_gateway.py`) and in `docker-compose.yml`.
- **Exception narrowing.** Route handlers catch `docker.errors.APIError` (with `status_code==409` → HTTP 409) and `docker.errors.DockerException` → HTTP 502. Bare `Exception` is never caught at the route layer — uncaught errors must surface as real 500s with stack traces, not flattened messages.

### Dependency injection

There is no DI container. Two small patterns instead:

- `get_docker_gateway()` in `infra/docker_gateway.py` is `@lru_cache(maxsize=1)` so the Docker client is a process-wide singleton (one persistent connection, not one per request).
- Routes inject via the modern `Annotated[X, Depends(...)]` form (ruff B008 flags the legacy default-arg form). The route layer composes the service per request: `EnvironmentService(docker_gateway)`. Tests swap the service entirely with `app.dependency_overrides[get_environment_service] = lambda: FakeEnvironmentService()` — see `tests/test_environments_routes.py`.

### URL construction

`_build_environment_url` builds `<scheme>://<container_name>.<host>[:<port>]/?folder=/home/workspace` from `PUBLIC_BASE_URL`. The workspace bind mount target inside the openvscode container is hard-coded to `/home/workspace`; the `folder` query param opens it on load.

## Configuration

Required env vars (see `.env.example`):

- `PUBLIC_BASE_URL` — base URL exposed to clients; hostname is used to build per-env subdomains (e.g. `http://localhost:8080` → `vscode-env-abc123.localhost:8080`).
- `ENV_NETWORK` — Docker network name; must match the network nginx and backend are on.
- `HOST_WORKSPACES_ROOT` — absolute path on the host where per-environment workspace dirs are created. Passed through 1:1 into the backend container.
- `OPENVSCODE_IMAGE` — image used for environment containers (default `gitpod/openvscode-server`).

## Testing strategy

Two layers, no real Docker daemon needed:

- `tests/test_environment_service.py` uses a handwritten `FakeDockerGateway` / `FakeContainer` (with `raise_on_start` / `raise_on_stop` flags) to exercise the reuse/replace branches and `stop_all` failure paths.
- `tests/test_environments_routes.py` uses `app.dependency_overrides` + `TestClient` to swap a `FakeEnvironmentService` in — verifies status-code mapping (201/400/404/422) without touching the service internals.
- `tests/conftest.py` exposes a `test_settings` fixture that `monkeypatch`-es the module-level `settings` singleton onto `tmp_path` so workspace dir creation is hermetic.

## CI

`.github/workflows/ci.yml` runs on every push and PR with three jobs:

- **`backend-checks`** — installs backend deps, `ruff check`, `pytest`, builds the backend Docker image, validates `docker compose config` (with placeholder env vars in the job's `env:` block — the validation does not require a real `HOST_WORKSPACES_ROOT` to exist).
- **`frontend-checks`** — `npm ci` (cached on `frontend/package-lock.json`), `npm run lint` (eslint), `npm run typecheck` (`tsc -b --noEmit`), `npm run build` (`tsc -b && vite build`), and `docker build -f frontend/Dockerfile .` to exercise the multi-stage Dockerfile from the repo-root context.
- **`publish-images`** — `needs: [backend-checks, frontend-checks]` and gated `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. Logs in to Docker Hub with `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets, then uses `docker/build-push-action@v6` with `platforms: linux/amd64,linux/arm64` (multi-arch via QEMU) to publish `lior8289/vscode-web-manager-backend` and `lior8289/vscode-web-manager-frontend` tagged `latest` + `sha-<short>`. Cached with `type=gha,mode=max`, scoped per image. Never runs on PRs.

The first two jobs must stay green on every PR. `publish-images` only runs on `main` and must stay green there.

## Reviewer flow (Docker Hub)

`docker-compose.hub.yml` is the zero-build entry point for reviewers. Same topology as `docker-compose.yml` but uses `image:` not `build:` and defaults every env var (including `HOST_WORKSPACES_ROOT=/tmp/vscode-web-manager-workspaces`, which Docker auto-creates on first bind-mount). The nginx config is baked into the frontend/nginx image (`deploy/nginx.conf` is `COPY`-ed in the runtime stage), so neither compose file bind-mounts it — the image is self-sufficient. If you change nginx routing, just rebuild the frontend image (CI does this automatically on push to `main`).
