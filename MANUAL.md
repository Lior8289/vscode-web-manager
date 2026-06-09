# MANUAL — VS Code Web Environment Manager

> Every command, every endpoint, every operation. Copy-paste reference for running, debugging, and inspecting the system end to end.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [First-time setup](#2-first-time-setup)
3. [Running the full stack with Docker Compose](#3-running-the-full-stack-with-docker-compose)
4. [Running the backend without Docker](#4-running-the-backend-without-docker)
5. [API reference — every endpoint](#5-api-reference--every-endpoint)
6. [Bypassing nginx (talk to backend directly)](#6-bypassing-nginx-talk-to-backend-directly)
7. [Inspecting Docker objects manually](#7-inspecting-docker-objects-manually)
8. [Testing](#8-testing)
9. [Linting](#9-linting)
10. [CI — what the pipeline runs](#10-ci--what-the-pipeline-runs)
11. [Cleanup and reset](#11-cleanup-and-reset)
12. [Troubleshooting — failure mode → fix](#12-troubleshooting--failure-mode--fix)
13. [One-liner recipes](#13-one-liner-recipes)

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker Engine | 20+ | `docker --version` |
| Docker Compose | v2 (built into Docker Desktop) | `docker compose version` |
| Python | 3.12 | `python3 --version` |
| `curl` | any | `curl --version` |
| `jq` (optional, for pretty JSON) | any | `jq --version` |

Optional but recommended:

```bash
# On macOS
brew install jq
```

---

## 2. First-time setup

From the repo root:

```bash
# 1. Copy the env template
cp .env.example .env

# 2. Edit .env — set HOST_WORKSPACES_ROOT to an ABSOLUTE host path
#    Example for this repo:
#    HOST_WORKSPACES_ROOT=/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/workspaces

# 3. Make sure that path exists (Compose will not create it for you)
mkdir -p "$HOST_WORKSPACES_ROOT"
```

Verify your `.env`:

```bash
cat .env
# PUBLIC_BASE_URL=http://localhost:8080
# ENV_NETWORK=vscode-manager-net
# HOST_WORKSPACES_ROOT=/abs/path/to/workspaces
# OPENVSCODE_IMAGE=gitpod/openvscode-server
```

---

## 3. Running the full stack with Docker Compose

All commands run from the **repo root** (where `docker-compose.yml` is).

### Bring it up

```bash
# Build images and start (foreground, logs streamed)
docker compose up --build

# Same but detached (background)
docker compose up -d --build

# After the first build, you can skip --build for faster restarts
docker compose up -d
```

Once up, you should see:

```bash
docker compose ps
# NAME                       IMAGE              STATUS         PORTS
# vscode-manager-backend     vscode-web-...     Up X seconds
# vscode-manager-nginx       nginx:1.27-alpine  Up X seconds   0.0.0.0:8080->80/tcp
```

### Bring it down

```bash
# Stop and remove the two managed containers (backend + nginx) + the network
docker compose down

# Also remove named/anonymous volumes (we don't define any, but it's the canonical cleanup)
docker compose down --volumes

# Also remove the local images we built
docker compose down --rmi local
```

> Important — `docker compose down` does **not** remove the per-env `vscode-env-*` containers (they aren't in the Compose file). Clean those up separately — see §11.

### Logs

```bash
# Tail logs from both services
docker compose logs -f

# Just the backend
docker compose logs -f backend

# Just nginx
docker compose logs -f nginx

# Last 100 lines only
docker compose logs --tail 100 backend
```

### Restart, rebuild, exec

```bash
# Restart a single service
docker compose restart backend

# Force a rebuild (e.g. after Dockerfile change)
docker compose up -d --build --force-recreate backend

# Open a shell inside the backend container
docker compose exec backend sh

# One-off command inside the backend container
docker compose exec backend python -c "from app.core.config import settings; print(settings)"
```

### Validate the Compose file

```bash
# Parses + resolves variables + prints the merged config (CI runs this)
docker compose config

# Just check that variables are set (will warn on missing ${...})
docker compose config --quiet
```

### Check status / health

```bash
docker compose ps

# Detailed inspect of a service
docker compose ps --format json | jq

# Resource usage (live)
docker stats vscode-manager-backend vscode-manager-nginx
```

---

## 4. Running the backend without Docker

For fast iteration on Python code (no nginx, no per-env subdomain resolution):

```bash
cd backend

# Create a virtualenv
python3 -m venv .venv
source .venv/bin/activate

# Install runtime + dev deps
pip install -r requirements.txt -r requirements-dev.txt

# Run uvicorn with auto-reload on file changes
uvicorn app.main:app --reload --port 8000
```

Now hit it directly at `http://localhost:8000` (note: port 8000, not 8080):

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

**Caveat:** without Docker Compose, the backend still needs Docker daemon access (it uses `docker.from_env()`). It will reach the Docker daemon via your local socket. You also need `HOST_WORKSPACES_ROOT` in `.env` (or exported) pointing somewhere writable. Without nginx, `vscode-env-*.localhost` won't resolve — you can only hit the management API, not the editor UIs.

**OpenAPI docs** are auto-generated:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Raw OpenAPI JSON: `http://localhost:8000/openapi.json`

---

## 5. API reference — every endpoint

All examples assume the stack is up via Docker Compose. Public entry point: `http://localhost:8080/api`. Paths inside the table are the backend's view (after nginx strips `/api/`).

> Quick reference

| Method | Path (via nginx) | Backend path | Body | Success | Notes |
|---|---|---|---|---|---|
| GET | `/health` | `/health` | — | `200` | Liveness, no Docker call |
| GET | `/api/docker/info` | `/docker/info` | — | `200` / `502` | Docker connectivity probe |
| POST | `/api/environments` | `/environments` | `{"mount_folder":"name"}` | `201` | Idempotent by `mount_folder` |
| GET | `/api/environments` | `/environments` | — | `200` | Only managed containers |
| GET | `/api/environments/{id}` | `/environments/{id}` | — | `200` / `404` | Full inspect details |
| POST | `/api/environments/{id}/stop` | `/environments/{id}/stop` | — | `200` / `404` | |
| POST | `/api/environments/stop-all` | `/environments/stop-all` | — | `200` | Batched, with `failed_count` |
| DELETE | `/api/environments/{id}` | `/environments/{id}` | — | `200` / `404` | Force-removes |

### 5.1 `GET /health` — liveness

```bash
curl -s http://localhost:8080/health | jq
```

Response:

```json
{ "status": "ok" }
```

Does **not** touch Docker. Always 200 if the backend process is alive.

### 5.2 `GET /api/docker/info` — Docker connectivity probe

```bash
curl -s http://localhost:8080/api/docker/info | jq
```

Response (success):

```json
{
  "docker": "connected",
  "server_version": "27.4.0",
  "containers": 5,
  "images": 23
}
```

Response (Docker daemon down) → `502`:

```json
{ "detail": "Error while fetching server API version: ..." }
```

### 5.3 `POST /api/environments` — create (or reuse)

```bash
# Create
curl -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' \
  -d '{"mount_folder":"demo"}' | jq
```

Response `201`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
  "workspace_path": "/abs/path/.../workspaces/demo",
  "reused": false
}
```

Now open the `url` in your browser. Files in the editor's `/home/workspace` appear in `workspaces/demo/` on the host.

#### Idempotent retry — returns the same container

```bash
# Run the same command again
curl -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' \
  -d '{"mount_folder":"demo"}' | jq '.reused'
# true
```

#### Trigger every failure mode

```bash
# 422 — schema rejects (slash, dot, space, empty, too long)
curl -i -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{"mount_folder":"../etc"}'
# HTTP/1.1 422 Unprocessable Entity

curl -i -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{"mount_folder":""}'
# HTTP/1.1 422 Unprocessable Entity

curl -i -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{}'
# HTTP/1.1 422 Unprocessable Entity (missing field)

# 400 — only triggerable if the schema regex is loosened; the resolved-path
# check in _resolve_workspace_path would raise ValueError -> 400
# (Not directly hittable with the current schema; documented for completeness.)
```

### 5.4 `GET /api/environments` — list

```bash
curl -s http://localhost:8080/api/environments | jq
```

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

Only containers labeled `managed-by=vscode-web-env-manager` are returned. Unrelated containers on the host are invisible.

Empty list when none exist:

```bash
curl -s http://localhost:8080/api/environments
# []
```

### 5.5 `GET /api/environments/{env_id}` — full details

```bash
ENV_ID=abc123def456
curl -s http://localhost:8080/api/environments/$ENV_ID | jq
```

Response `200`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "image": "gitpod/openvscode-server",
  "labels": {
    "managed-by": "vscode-web-env-manager",
    "env-id": "abc123def456",
    "mount-folder": "demo"
  },
  "mounts": [
    {
      "Type": "bind",
      "Source": "/abs/path/.../workspaces/demo",
      "Destination": "/home/workspace",
      "Mode": "rw",
      "RW": true
    }
  ],
  "networks": {
    "vscode-manager-net": { "...": "..." }
  }
}
```

Unknown id → `404`:

```bash
curl -i -s http://localhost:8080/api/environments/missing000000
# HTTP/1.1 404 Not Found
# {"detail":"Environment not found"}
```

### 5.6 `POST /api/environments/{env_id}/stop`

```bash
curl -s -X POST http://localhost:8080/api/environments/$ENV_ID/stop | jq
```

Response `200`:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "exited"
}
```

Unknown id → `404`.

After stopping, the container still exists (just stopped). Listing shows it with `status: "exited"`. To restart it, call `POST /environments` with the same `mount_folder` — reuse logic will `start` it again.

### 5.7 `POST /api/environments/stop-all`

```bash
curl -s -X POST http://localhost:8080/api/environments/stop-all | jq
```

Response `200`:

```json
{
  "stopped_count": 2,
  "skipped_count": 1,
  "failed_count": 0,
  "environments": [
    { "id": "aaa...", "container_name": "vscode-env-aaa...",
      "previous_status": "running", "status": "exited", "skipped": false },
    { "id": "bbb...", "container_name": "vscode-env-bbb...",
      "previous_status": "running", "status": "exited", "skipped": false },
    { "id": "ccc...", "container_name": "vscode-env-ccc...",
      "previous_status": "exited",  "status": "exited", "skipped": true }
  ],
  "failures": []
}
```

- `stopped_count` — were running, now exited.
- `skipped_count` — already stopped, untouched.
- `failed_count` — raised during `.stop()` (recorded by id in `failures`).

A batch op never aborts on a single failure — every container is tried, results are tallied at the end.

### 5.8 `DELETE /api/environments/{env_id}`

```bash
curl -s -X DELETE http://localhost:8080/api/environments/$ENV_ID | jq
```

Response `200`:

```json
{ "id": "abc123def456", "removed": true }
```

Force-removes — works whether the container is running or stopped. Workspace folder on the host is **not** removed (data is preserved).

Unknown id → `404`.

---

## 6. Bypassing nginx (talk to backend directly)

When debugging "is it nginx or the backend?" you can hit the backend on its internal port. Two ways:

### From inside the Docker network

```bash
# Run a one-off curl container on the same network
docker run --rm --network vscode-manager-net curlimages/curl:latest \
  curl -s http://backend:8000/health
# {"status":"ok"}

# Or list environments
docker run --rm --network vscode-manager-net curlimages/curl:latest \
  curl -s http://backend:8000/environments
```

### From the host (only when running uvicorn locally)

If the backend is running natively via `uvicorn app.main:app --port 8000`:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/environments
curl http://localhost:8000/docker/info
```

When using Docker Compose, the backend is **not** exposed to the host (no `ports:` block) — by design. Use the `--network` trick above.

---

## 7. Inspecting Docker objects manually

When the API isn't telling you enough, look at Docker directly.

### Containers

```bash
# All managed env containers (running + stopped)
docker ps -a --filter label=managed-by=vscode-web-env-manager

# Only running
docker ps --filter label=managed-by=vscode-web-env-manager

# With formatted output
docker ps -a --filter label=managed-by=vscode-web-env-manager \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Label "mount-folder"}}'

# Inspect everything about one container
docker inspect vscode-env-abc123def456

# Specific fields with jq
docker inspect vscode-env-abc123def456 | \
  jq '.[0] | {Status: .State.Status, Mounts: .Mounts, Labels: .Config.Labels}'

# Live logs from an env container (openvscode-server output)
docker logs -f vscode-env-abc123def456

# Last 50 lines only
docker logs --tail 50 vscode-env-abc123def456

# Exec into an env container (interactive shell)
docker exec -it vscode-env-abc123def456 bash

# Run a one-off command inside
docker exec vscode-env-abc123def456 ls -la /home/workspace
```

### The Docker network

```bash
# List networks
docker network ls

# Inspect ours
docker network inspect vscode-manager-net

# See which containers are attached
docker network inspect vscode-manager-net | jq '.[0].Containers | map(.Name)'
```

### Test that Docker's embedded DNS works

```bash
# From inside the backend container, can we resolve an env container name?
docker compose exec backend python -c "import socket; print(socket.gethostbyname('vscode-env-abc123def456'))"
# 172.x.x.x   <-- the env container's IP

# From inside the nginx container, same test
docker compose exec nginx getent hosts vscode-env-abc123def456
```

If this fails, the env container isn't on `manager-net` (check `ENV_NETWORK` consistency).

### Manually stop / remove an env container

If the API is unreachable, you can fall back to raw Docker:

```bash
# Stop one
docker stop vscode-env-abc123def456

# Remove (force kills + removes)
docker rm -f vscode-env-abc123def456

# Stop all managed
docker ps -q --filter label=managed-by=vscode-web-env-manager | xargs -r docker stop

# Remove all managed (running + stopped)
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f
```

### Images

```bash
# Is the openvscode image cached locally?
docker images gitpod/openvscode-server

# Manually pull (useful for warm-up before demos)
docker pull gitpod/openvscode-server

# Remove the image (forces a fresh pull next time)
docker rmi gitpod/openvscode-server
```

---

## 8. Testing

All test commands run from `backend/` with the venv activated.

```bash
cd backend
source .venv/bin/activate
```

### Run everything

```bash
python -m pytest
# or with extra verbosity
python -m pytest -v
```

### Run one file

```bash
python -m pytest tests/test_schemas.py
python -m pytest tests/test_environment_service.py
python -m pytest tests/test_environments_routes.py
python -m pytest tests/test_health.py
```

### Run one test

```bash
python -m pytest tests/test_schemas.py::test_create_environment_request_accepts_valid_mount_folder
```

### Run by keyword

```bash
# Any test whose name contains "mount_folder"
python -m pytest -k mount_folder

# Combine (AND / OR / NOT)
python -m pytest -k "mount_folder and not invalid"
python -m pytest -k "stop_all or reuse"
```

### Stop on first failure

```bash
python -m pytest -x
```

### Show local variables on failure

```bash
python -m pytest -l
```

### Capture stdout/stderr (for `print` debugging)

```bash
python -m pytest -s
```

### See the slowest 10 tests

```bash
python -m pytest --durations=10
```

### Useful combos

```bash
# Verbose, fail fast, show variables, last failed first
python -m pytest -v -x -l --lf
```

---

## 9. Linting

```bash
cd backend

# Check (CI runs this; exits non-zero on issues)
python -m ruff check .

# Auto-fix what's auto-fixable
python -m ruff check --fix .

# Check a single file
python -m ruff check app/services/environment_service.py

# Show what would be fixed without writing
python -m ruff check --diff .

# Format (not run by CI today; useful locally)
python -m ruff format .
python -m ruff format --check .   # dry-run
```

The rules in `pyproject.toml` are `E` (pycodestyle errors), `F` (pyflakes), `I` (isort), `B` (bugbear).

---

## 10. CI — what the pipeline runs

`.github/workflows/ci.yml` triggers on `push` and `pull_request`. To replicate locally:

```bash
cd backend

# Step 1+2: install
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt

# Step 3: lint
python -m ruff check .

# Step 4: tests
python -m pytest

# Step 5: build the backend image (from repo root)
cd ..
docker build -t vscode-manager-backend ./backend

# Step 6: validate compose (CI sets placeholder env vars in the job)
PUBLIC_BASE_URL=http://localhost:8080 \
ENV_NETWORK=vscode-manager-net \
HOST_WORKSPACES_ROOT=/tmp/vscode-workspaces \
OPENVSCODE_IMAGE=gitpod/openvscode-server \
  docker compose config
```

If all six commands exit 0, CI will pass.

### Inspecting CI runs

If you have `gh` CLI installed and the repo is on GitHub:

```bash
# List recent runs
gh run list --workflow ci.yml

# View a specific run
gh run view <run-id>

# Watch a run in progress
gh run watch
```

---

## 11. Cleanup and reset

### Soft reset (keep workspaces, keep images)

```bash
# From repo root
docker compose down

# Stop and remove all per-env containers
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f

# Bring it back up
docker compose up -d
```

### Hard reset (nuke everything we made)

```bash
# 1. Tear down the Compose stack + the network
docker compose down

# 2. Remove all per-env containers
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f

# 3. Remove the backend image (forces rebuild)
docker rmi $(docker images -q vscode-manager-backend 2>/dev/null) 2>/dev/null

# 4. Remove the openvscode image (forces re-pull; ~600 MB)
docker rmi gitpod/openvscode-server

# 5. Wipe all workspace data on the host (DESTRUCTIVE — your code lives here)
# Only run this if you really mean it
rm -rf "$HOST_WORKSPACES_ROOT"/*

# 6. Verify nothing of ours is left
docker ps -a --filter label=managed-by=vscode-web-env-manager
docker network ls | grep vscode-manager-net
```

### Just clean up dangling Docker state (system-wide)

```bash
# Removes: stopped containers, networks not used, dangling images, build cache
docker system prune

# Same but also removes images not in use by any container
docker system prune -a

# And volumes (we have none, but for completeness)
docker system prune -a --volumes
```

### Remove the Python venv

```bash
cd backend
deactivate 2>/dev/null
rm -rf .venv __pycache__ .pytest_cache .ruff_cache
find . -name '__pycache__' -type d -exec rm -rf {} +
```

---

## 12. Troubleshooting — failure mode → fix

### "Cannot connect to the Docker daemon"

The backend can't reach `/var/run/docker.sock`.

```bash
# Is Docker running?
docker info
# On macOS — open Docker Desktop. On Linux — sudo systemctl start docker

# Is the socket mounted into the backend?
docker compose exec backend ls -la /var/run/docker.sock
# srw-rw---- 1 root ...

# Check the probe endpoint
curl -s http://localhost:8080/api/docker/info
```

### "502 Bad Gateway" from nginx for `/api/...`

nginx is up but can't reach the backend.

```bash
# Is the backend actually running?
docker compose ps backend

# Is it reachable from inside the network?
docker compose exec nginx wget -qO- http://backend:8000/health
# {"status":"ok"}

# Backend logs?
docker compose logs --tail 100 backend
```

### Subdomain URL returns 404 / nginx default page

nginx is not matching the regex `server_name`. Either the container name doesn't match `vscode-env-[a-f0-9]{12}`, or the env container isn't on `manager-net`.

```bash
# Check the env container's exact name
docker ps --filter label=managed-by=vscode-web-env-manager --format '{{.Names}}'
# vscode-env-abc123def456 <-- must be exactly this shape

# Check it's on the right network
docker inspect vscode-env-abc123def456 | jq '.[0].NetworkSettings.Networks | keys'
# ["vscode-manager-net"]

# Can nginx resolve it?
docker compose exec nginx getent hosts vscode-env-abc123def456
```

### Env URL loads but WebSocket features don't work (terminal, file watcher)

WebSocket upgrade is failing. Check that nginx has `proxy_http_version 1.1` and the Upgrade/Connection headers (in `nginx/nginx.conf`). Also try:

```bash
# From the host, hit the env container directly through the network
docker run --rm --network vscode-manager-net curlimages/curl:latest \
  curl -i http://vscode-env-abc123def456:3000/

# Browser dev tools → Network tab → WS filter → check the 101 Switching Protocols
```

### `POST /environments` returns 422

The `mount_folder` failed schema validation. It must match `^[a-zA-Z0-9_-]+$` and be 1–80 chars.

```bash
# Inspect what FastAPI said
curl -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{"mount_folder":"bad/name"}' | jq
# {"detail":[{"type":"string_pattern_mismatch","loc":["body","mount_folder"], ...}]}
```

### `POST /environments` returns 400 with "must stay inside"

The resolved path escaped `HOST_WORKSPACES_ROOT`. This shouldn't happen with the current schema; if it does, check that `HOST_WORKSPACES_ROOT` is absolute and exists.

### `POST /environments` returns 502

Docker daemon is unhealthy or unreachable from the backend. See "Cannot connect to the Docker daemon" above. Check logs:

```bash
docker compose logs --tail 100 backend
```

### An env container won't start (or crashes immediately)

```bash
# Why did it die?
docker logs vscode-env-abc123def456

# What's the exit status?
docker inspect vscode-env-abc123def456 | jq '.[0].State'

# Most common cause: out-of-disk during image pull. Check:
df -h
docker system df
```

### `docker compose up` says "network manager-net already exists" with different config

You changed `ENV_NETWORK` after first creating it.

```bash
docker compose down
docker network rm vscode-manager-net
docker compose up -d
```

### Stale env containers from a previous run

```bash
# See what's lying around
docker ps -a --filter label=managed-by=vscode-web-env-manager

# Nuke them all
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f
```

### "Permission denied" on workspace files inside the editor

The openvscode-server container runs as a non-root user. If the host directory was created with restrictive perms, writes will fail.

```bash
# Check perms
ls -la "$HOST_WORKSPACES_ROOT"

# Open up the workspace dirs (development only)
chmod -R 777 "$HOST_WORKSPACES_ROOT"
```

### Backend logs are silent / not showing print output

Docker captures stdout in real time because the Dockerfile sets `PYTHONUNBUFFERED=1`. If you still see nothing:

```bash
# Make sure you're not in detached mode without -f
docker compose logs -f backend
```

---

## 13. One-liner recipes

### Full smoke test of the API

```bash
# Create, list, get, stop, recreate, delete, in order
ENV_ID=$(curl -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{"mount_folder":"smoke"}' | jq -r '.id') && \
echo "Created: $ENV_ID" && \
curl -s http://localhost:8080/api/environments | jq '.[] | {id, status, mount_folder}' && \
curl -s http://localhost:8080/api/environments/$ENV_ID | jq '{id, status, image}' && \
curl -s -X POST http://localhost:8080/api/environments/$ENV_ID/stop | jq && \
curl -s -X POST http://localhost:8080/api/environments \
  -H 'Content-Type: application/json' -d '{"mount_folder":"smoke"}' | jq '{id, status, reused}' && \
curl -s -X DELETE http://localhost:8080/api/environments/$ENV_ID | jq
```

### Watch the env list every second

```bash
watch -n 1 'curl -s http://localhost:8080/api/environments | jq'
```

### Count managed containers by status

```bash
curl -s http://localhost:8080/api/environments | jq 'group_by(.status) | map({status: .[0].status, count: length})'
```

### Stop everything and wait for it to actually stop

```bash
curl -s -X POST http://localhost:8080/api/environments/stop-all | jq
sleep 2
docker ps --filter label=managed-by=vscode-web-env-manager
```

### Stress-test with N parallel creates (different mount_folder each)

```bash
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:8080/api/environments \
    -H 'Content-Type: application/json' \
    -d "{\"mount_folder\":\"stress$i\"}" &
done
wait
curl -s http://localhost:8080/api/environments | jq 'length'
```

### Delete every managed environment

```bash
curl -s http://localhost:8080/api/environments | jq -r '.[].id' | \
  while read id; do
    echo "Deleting $id"
    curl -s -X DELETE http://localhost:8080/api/environments/$id | jq
  done
```

### Tail every env container's logs

```bash
docker ps -q --filter label=managed-by=vscode-web-env-manager | \
  xargs -I {} sh -c 'echo "=== {} ==="; docker logs --tail 20 {}'
```

### Show what nginx sees as upstream for an env

```bash
docker compose exec nginx sh -c '
  for c in $(getent hosts vscode-env-abc123def456 2>/dev/null); do
    echo "Resolved to: $c"
  done
'
```

---

## Appendix — environment variable cheat sheet

| Variable | Required | Example | Used by |
|---|---|---|---|
| `PUBLIC_BASE_URL` | Yes | `http://localhost:8080` | backend (URL building), Compose interpolation |
| `ENV_NETWORK` | Yes | `vscode-manager-net` | backend (attaching env containers), Compose (network name) |
| `HOST_WORKSPACES_ROOT` | Yes | `/Users/.../workspaces` (**absolute**) | backend (bind mounts), Compose (passthrough mount) |
| `OPENVSCODE_IMAGE` | No (default: `gitpod/openvscode-server`) | `gitpod/openvscode-server:latest` | backend (image to run) |

All four are read from `.env` by both Compose (variable substitution) and by the backend at startup (via `pydantic-settings`).
