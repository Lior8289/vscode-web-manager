# VS Code Web Environment Manager

A small local service that spins up browser-accessible [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server) environments on demand and exposes management endpoints for the containers, networks, and volumes it owns. FastAPI talks to the host Docker daemon over its socket; nginx is the public entry point and routes each environment to its own subdomain.

Submitted as the **Cymotive home assignment**.

## Running the application

### Prerequisites

- **Docker Desktop** (macOS / Windows) or **Docker Engine** (Linux) — running.
- **Git**.

### 1. Clone the repository

```bash
git clone https://github.com/Lior8289/vscode-web-manager.git
cd vscode-web-manager
```

### 2. Run the launcher script

**macOS / Linux:**

```bash
./my-vscode-app.sh
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File .\my-vscode-app.ps1
```

The script pulls the prebuilt multi-arch images from Docker Hub, brings up the full stack via `docker-compose.hub.yml`, polls `/health` until the backend is ready, and prints the dashboard URL.

### 3. Open the dashboard

Open the URL the script prints — by default <http://localhost:8080>. From there click **New environment**, give it a folder name (e.g. `demo`), and click the resulting URL to open VS Code in a new tab. Files saved in `/home/workspace` inside VS Code persist to `/tmp/vscode-web-manager-workspaces/demo/` on the host.

### 4. Stop the stack

```bash
docker compose -f docker-compose.hub.yml down
```

### API endpoints

All endpoints share the same origin as the dashboard. Replace `http://localhost:8080` with whatever URL the script printed.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Backend liveness check. Returns `{"status":"ok"}`. |
| `GET` | `/api/docker/info` | Docker daemon connectivity, server version, container/image counts. |
| `POST` | `/api/environments` | Create a VS Code environment. Body: `{"mount_folder":"demo"}`. |
| `GET` | `/api/environments` | List every managed environment with status and URL. |
| `GET` | `/api/environments/{id}` | Inspect one environment (image, labels, mounts, networks). |
| `POST` | `/api/environments/{id}/stop` | Stop one environment without removing it. |
| `POST` | `/api/environments/stop-all` | Stop every running environment, with per-container detail. |
| `DELETE` | `/api/environments/{id}` | Force-remove an environment container. |

For full request/response examples see [API reference](#api-reference).

### Persistent workspaces (optional)

Workspaces default to `/tmp/vscode-web-manager-workspaces` (auto-created on first run; cleared on host reboot — ideal for a demo). To persist them across reboots, set `HOST_WORKSPACES_ROOT` before running the script:

```bash
# macOS / Linux
HOST_WORKSPACES_ROOT="$HOME/vscode-workspaces" ./my-vscode-app.sh
```

```powershell
# Windows (PowerShell)
$env:HOST_WORKSPACES_ROOT = "$HOME\vscode-workspaces"
powershell -ExecutionPolicy Bypass -File .\my-vscode-app.ps1
```

To fetch a fresh `latest` later: `docker compose -f docker-compose.hub.yml pull` and re-run the script.

## Architecture

```
                    ┌────────────────────────────────────────────┐
                    │              host machine                  │
                    │                                            │
                    │   ┌──────────────┐    HOST_WORKSPACES_ROOT │
   browser ──:8080──┼──▶│    nginx     │       (bind mount)      │
                    │   └──────┬───────┘             ▲           │
                    │          │                     │           │
                    │     ┌────┴──────┐              │           │
                    │     │           │              │           │
                    │     ▼           ▼              │           │
                    │   /api/    vscode-env-*        │           │
                    │     │      .localhost          │           │
                    │     ▼           │              │           │
                    │  ┌──────────┐   │              │           │
                    │  │ backend  │   │              │           │
                    │  │ FastAPI  │   │              │           │
                    │  └────┬─────┘   │              │           │
                    │       │         │              │           │
                    │       │ docker  │              │           │
                    │       │ socket  │              │           │
                    │       ▼         │              │           │
                    │  ┌──────────┐   │              │           │
                    │  │  Docker  │   │              │           │
                    │  │  daemon  │   │              │           │
                    │  └────┬─────┘   │              │           │
                    │       │ creates │              │           │
                    │       ▼         ▼              │           │
                    │   ┌────────────────────┐       │           │
                    │   │ vscode-env-<12hex> │───────┘           │
                    │   │  (openvscode)      │  /home/workspace  │
                    │   └────────────────────┘                   │
                    │         on manager-net                     │
                    └────────────────────────────────────────────┘
```

Three runtime pieces wired on a single Docker network (`manager-net`, name from `ENV_NETWORK`):

1. **nginx** (port 8080) — two virtual hosts. `localhost` proxies `/api/` to the backend and `/health` directly. A regex host `~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$` captures the container name from the subdomain and proxies to `http://$vscode_container:3000`, relying on Docker's embedded DNS (`resolver 127.0.0.11`) to resolve it.
2. **backend** — FastAPI app. Owns all container lifecycle through `DockerGateway` (the only place that imports the `docker` SDK). Talks to the daemon via the mounted `/var/run/docker.sock`.
3. **per-env openvscode-server containers** — Created on demand with the labels `managed-by=vscode-web-env-manager`, `env-id=<hex>`, `mount-folder=<name>`. Named `vscode-env-<12-hex>` so the nginx regex matches.

The same nginx container also serves a React dashboard at `http://localhost:8080/`. The dashboard, the `/api/*` routes, and the per-environment subdomains all share one origin (no CORS) and one port. See [Frontend](#frontend).

## Repository layout

```text
vscode-web-manager/
  backend/                 FastAPI control plane, Docker SDK adapter, tests
  frontend/                React/Vite dashboard source and frontend Dockerfile
  deploy/nginx.conf        Public gateway config for SPA, API, and editor routing
  postman/                 Postman collection for API smoke testing
  docker-compose.yml       Local source-build stack
  docker-compose.hub.yml   Zero-build reviewer stack using Docker Hub images
```

`deploy/nginx.conf` is intentionally outside `frontend/`: nginx is the public gateway for the full app, not just static frontend hosting. The config is still baked into the frontend/nginx image at build time so the Docker Hub image remains self-contained.

## Quickstart (build from source)

For development with code changes. `.env.example` defaults `HOST_WORKSPACES_ROOT` to `/tmp/vscode-web-manager-workspaces` (works zero-edit); change it to a path inside the repo if you want workspaces to persist across reboots.

```bash
cp .env.example .env
docker compose up --build

# Create an environment
curl -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' \
  -d '{"mount_folder": "demo"}'
# {"id":"abc123def456","container_name":"vscode-env-abc123def456","status":"running",
#  "url":"http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
#  "workspace_path":"/Users/you/.../workspaces/demo","reused":false}

# Open the returned URL in your browser. Files you create in /home/workspace
# inside VS Code will appear in workspaces/demo/ on the host, and vice versa.
```

## Configuration

| Env var                | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `PUBLIC_BASE_URL`      | Base URL exposed to clients; the hostname is used to build per-env subdomains. |
| `ENV_NETWORK`          | Docker network name (must be the same for backend, nginx, and env containers). |
| `HOST_WORKSPACES_ROOT` | **Absolute** host path under which per-environment workspace directories live. |
| `OPENVSCODE_IMAGE`     | Image used for environment containers (default `gitpod/openvscode-server`).    |

`HOST_WORKSPACES_ROOT` must be absolute because it is bind-mounted 1:1 into the backend container (`${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}`); see the trade-offs section for why.

## API reference

All paths below are relative to `http://localhost:8080/api`. The backend itself listens on port 8000 inside the network — nginx is the public entry point.

### `POST /environments` — create or reuse

Request:

```json
{ "mount_folder": "demo" }
```

- `mount_folder` is required, must match `^[a-zA-Z0-9_-]+$` (1–80 chars).

Response `201`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
  "workspace_path": "/abs/path/to/workspaces/demo",
  "reused": false
}
```

- `reused: true` when an existing container for the same `mount_folder` was found and returned (see _idempotency_ below).

Error mapping:

- `400` — `mount_folder` resolved outside `HOST_WORKSPACES_ROOT` (defense-in-depth path check).
- `409` — Docker reported a name conflict (rare; transient race).
- `422` — `mount_folder` failed regex / length validation.
- `502` — Docker daemon unreachable or other Docker API error.

### `GET /environments` — list

Response `200`:

```json
[
  {
    "id": "abc123def456",
    "container_name": "vscode-env-abc123def456",
    "status": "running",
    "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
    "mount_folder": "demo"
  }
]
```

Only containers labeled `managed-by=vscode-web-env-manager` are returned — unrelated containers on the host are never touched.

### `GET /environments/{env_id}` — details

Response `200`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "image": "gitpod/openvscode-server",
  "labels": { "managed-by": "...", "env-id": "...", "mount-folder": "demo" },
  "mounts": [ { "Source": "...", "Destination": "/home/workspace", "Mode": "rw" } ],
  "networks": { "vscode-manager-net": { ... } }
}
```

- `404` when the env id is unknown.

### `POST /environments/{env_id}/stop`

Response `200`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "exited"
}
```

- `404` when the env id is unknown.

### `POST /environments/stop-all`

Response `200`:

```json
{
  "stopped_count": 1,
  "skipped_count": 0,
  "failed_count": 0,
  "environments": [{ "id": "...", "status": "exited", "skipped": false }],
  "failures": []
}
```

### `DELETE /environments/{env_id}`

Response `200`:

```json
{ "id": "abc123def456", "removed": true }
```

- `404` when the env id is unknown.

### `GET /docker/info`

Lightweight Docker connectivity probe. `200` with `{ "docker": "connected", ... }` when the daemon is reachable; `502` otherwise.

### `GET /health`

`200 { "status": "ok" }` — liveness only; does not touch Docker.

## Engineering trade-offs

These are the calls I made and would defend in a review:

### 1. Sandboxed `mount_folder` instead of arbitrary host paths

The assignment example is `GET /createEnv?mount_folder=/home/usr`. I instead accept a **name** (`mount_folder=demo`) and resolve it to a subfolder of `HOST_WORKSPACES_ROOT`. Two defenses, in order:

1. **Pydantic regex** (`schemas.py`): `^[a-zA-Z0-9_-]+$`, 1–80 chars — rejects slashes, dots, and absolute paths at the edge.
2. **Resolved-path check** (`service.py:_resolve_workspace_path`): even if the regex were relaxed, the resolved path is required to be inside `HOST_WORKSPACES_ROOT`, otherwise `ValueError → 400`.

Accepting an arbitrary host path on an unauthenticated HTTP endpoint turns a one-line input into a remote read/write primitive against the host filesystem. The PDF explicitly says the API shape is open, so I took the more defensible shape.

### 2. Host-path passthrough mount

`docker-compose.yml` mounts `${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}` so the path is identical inside and outside the backend container. When the backend tells the Docker daemon to bind-mount a workspace into a new container, those paths are interpreted by the **daemon** (which runs on the host) — so they must be valid host paths. Using the same path on both sides avoids any translation step. `HOST_WORKSPACES_ROOT` must therefore be absolute.

### 3. Idempotency by `mount-folder` label

`POST /environments {"mount_folder":"demo"}` looks for an existing container labeled `mount-folder=demo`:

- **running** → return it as-is with `reused: true`.
- **exited** → start it, return with `reused: true`.
- **start fails** → remove the broken container and provision a fresh one.

The user gets a stable environment per folder without an explicit "find or create" branch in their client. Covered end-to-end by `tests/test_environment_service.py`.

### 4. Container naming coupled to the nginx regex

Container names are `vscode-env-<uuid4-hex[:12]>`. nginx's `server_name ~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$` matches that exact shape and feeds the captured name straight to `proxy_pass http://$vscode_container:3000`. Docker's embedded DNS does the resolution inside `manager-net`. If you change the naming format, you must change the regex; both are called out in `CLAUDE.md` for future-me.

### 5. `managed-by` label as the trust boundary

The backend only ever lists, stops, or removes containers whose `managed-by` label equals `vscode-web-env-manager`. Containers on the host that don't carry this label are invisible to the service. This is the boundary between "things we own" and "things that happen to share the daemon."

### 6. `Annotated[X, Depends(...)]` + `lru_cache` for the gateway

`get_docker_gateway()` is `@lru_cache(maxsize=1)` and routes inject the gateway via the modern FastAPI `Annotated` form. Two payoffs: one persistent Docker client connection across requests instead of one per call, and clean test injection via `app.dependency_overrides[get_environment_service]` (see `tests/test_environments_routes.py`).

### 7. `restart: unless-stopped` (not `always`)

Backend, nginx, and per-env containers all use `unless-stopped`. `always` would override an explicit `POST /environments/{id}/stop` on the next daemon reconciliation, making the stop endpoint a lie. `unless-stopped` respects an operator stop and only revives containers that exited on their own or were running before a host reboot.

### 8. Narrowed route exceptions

Routes catch `docker.errors.APIError` (with a special case for `status_code==409` → HTTP 409) and `docker.errors.DockerException` → HTTP 502 (Docker side is unhealthy). Anything else propagates so FastAPI logs a real 500 with a stack trace, instead of a flattened "Internal Server Error" with no signal.

## Local development (without Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
# OpenAPI docs at http://localhost:8000/docs
```

Without nginx, the env-container subdomains won't resolve — useful only for hitting the API directly.

## Frontend

A React dashboard lives in `frontend/`. It's the same-origin SPA that talks to the backend through the `/api/` path and opens per-environment URLs in a new tab.

```
http://localhost:8080
  ├── /          → React dashboard       (served by nginx)
  ├── /api/*     → FastAPI backend       (proxied by nginx)
  ├── /health    → FastAPI backend       (proxied by nginx)
  └── vscode-env-<hex>.localhost:8080
                 → per-env openvscode    (proxied by nginx via subdomain regex)
```

### Stack

| Layer         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Build         | Vite 8 + TypeScript 6                                        |
| UI primitives | Radix UI (Dialog), hand-built `Button`, `Sheet`, etc.        |
| Styling       | Tailwind CSS 4 (`@theme` tokens, no config file)             |
| Server state  | TanStack Query 5 (3s polling on list, 10s on health)         |
| Forms         | react-hook-form + zod (validation mirrors the backend regex) |
| Toasts        | sonner — distinguishes `created` vs `reused`                 |

### Run in dev (hot reload, no Docker)

```bash
# Terminal 1 — backend
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend (Vite proxies /api → :8000)
cd frontend && npm install && npm run dev
# Dashboard at http://localhost:5173
```

### Build, lint, typecheck

```bash
cd frontend
npm run lint        # eslint
npm run typecheck   # tsc -b --noEmit
npm run build       # tsc -b && vite build → dist/
```

### How it ships in Docker

The existing `nginx` service in `docker-compose.yml` builds with `frontend/Dockerfile` from the repo root. It is a multi-stage build that compiles the React app in `node:20-alpine`, then copies the `dist/` into `nginx:1.27-alpine` along with `deploy/nginx.conf`. The nginx config has one `location /` block to serve the static assets with an SPA fallback to `index.html`; the existing `/api/`, `/health`, and the subdomain-regex routing are unchanged. There is no separate frontend container, and the config is baked into the image (no compose-time bind mount), so `docker-compose.hub.yml` is a true image-only entry point — reviewers don't need the nginx config on disk.

### Keyboard shortcuts

| Key   | Action                        |
| ----- | ----------------------------- |
| `N`   | Open the "Provision" dialog   |
| `R`   | Refresh environments + health |
| `Esc` | Dismiss any dialog or sheet   |

## Testing

```bash
cd backend
python -m ruff check .   # lint
python -m pytest -v      # 36 tests; service layer + route layer + schemas + health
```

Service tests use a handwritten `FakeDockerGateway` (`tests/test_environment_service.py`) — no Docker daemon needed. Route tests use `app.dependency_overrides` to inject a fake service (`tests/test_environments_routes.py`), so status-code mapping is verified without touching real containers.

## CI

`.github/workflows/ci.yml` runs on every push and PR. Three jobs:

- **`backend-checks`** — installs Python deps, `ruff check`, `pytest`, builds the backend Docker image, validates `docker compose config`.
- **`frontend-checks`** — installs npm deps, `eslint`, `tsc -b --noEmit`, `vite build`, builds the frontend/nginx Docker image using `frontend/Dockerfile` from the repo root.
- **`publish-images`** — runs only after both check jobs pass _and only on push to `main`_. Logs in to Docker Hub, builds both images for `linux/amd64` + `linux/arm64` using buildx + QEMU, pushes them as `lior8289/vscode-web-manager-{backend,frontend}:latest` plus a `sha-<short>` tag for traceability. Cached via `type=gha` so warm builds finish in ~90s. Never runs on PRs (no secret exposure, no risk of publishing unverified code).

## AI usage note

AI tools were used at multiple stages of this project. All generated output was reviewed, adjusted, tested locally, and validated through GitHub Actions before being included:

- **Project planning** — early architecture exploration, stack decisions, and the FastAPI ↔ `DockerGateway` ↔ nginx layering (single-responsibility split, where domain exceptions become HTTP status codes, where the Docker SDK lives).
- **Configuration and complex files** — `deploy/nginx.conf` (the subdomain-regex virtual host with Docker embedded-DNS resolution, baked into the frontend/nginx image), `docker-compose.yml` and `docker-compose.hub.yml` (host-path passthrough mount, env-var defaults, reviewer zero-config flow), the backend and frontend `Dockerfile`s (slim Python image, multi-stage Vite + nginx build), and `.github/workflows/ci.yml` (parallel check jobs + multi-arch Docker Hub publish via buildx, QEMU, and GHA layer cache).
- **Test writing** — the `FakeDockerGateway` / `FakeContainer` pattern in `tests/test_environment_service.py` for hermetic service-layer tests, and the `app.dependency_overrides` route tests in `tests/test_environments_routes.py` that verify status-code mapping without a real Docker daemon.
- **Afterward polish and code scans** — README wording and structure, error-mapping consistency between the route layer and service exceptions, and a security review of `mount_folder` validation (the Pydantic regex plus the resolved-path defense in depth).
