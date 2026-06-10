# Interview Preparation: VS Code Web Environment Manager

This document was prepared from a full review of the project under `vscode-web-manager/`, including backend code, frontend code, Docker and nginx setup, CI/CD, tests, Postman collection, and project documentation.

It is written for a technical interview: start with the high-level story, then be ready to defend every technical detail.

---

## 1. Project Overview

The project is a local web-based environment manager for browser-accessible VS Code workspaces.

At a high level, a user opens a React dashboard at `http://localhost:8080`, creates a workspace by entering a folder name such as `demo`, and the backend provisions an `openvscode-server` Docker container for that workspace. The backend returns a URL like:

```text
http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace
```

That URL is routed by nginx to the correct container based on the subdomain. The editor runs inside its own container, while the workspace data is bind-mounted from the host so files persist outside the container lifecycle.

The main runtime pieces are:

- React dashboard, built with Vite and served by nginx.
- FastAPI backend, responsible for environment lifecycle operations.
- nginx reverse proxy, responsible for serving the dashboard, routing API calls, and routing environment subdomains.
- Docker daemon, accessed through `/var/run/docker.sock`.
- Per-environment `gitpod/openvscode-server` containers.

---

## 2. What Problem The Project Solves

The project solves the problem of quickly launching isolated, browser-based development environments on a local Docker host.

Instead of manually running `docker run`, creating bind mounts, exposing ports, and tracking container names, the user gets:

- A simple dashboard for provisioning and managing VS Code environments.
- One environment per workspace folder.
- Stable URLs for each running environment.
- Automatic reuse of existing stopped/running containers for the same workspace folder.
- Centralized lifecycle operations: list, inspect, stop, stop all, and remove.
- Workspace data persistence through host bind mounts.

The project is especially suitable as a home-assignment demonstration of backend architecture, Docker orchestration, reverse proxying, validation, and CI/CD.

It is not production-ready as-is for a multi-user public environment. The most important production gaps are authentication, authorization, Docker socket hardening, resource limits, end-to-end tests, and concurrency protection.

---

## 3. High-Level System Architecture

```text
Browser
  |
  | http://localhost:8080
  v
nginx container
  |-- serves React SPA from /usr/share/nginx/html
  |-- proxies /api/* to FastAPI backend
  |-- proxies vscode-env-<id>.localhost to openvscode containers
  |
  +--> backend container: FastAPI on port 8000
  |       |
  |       +--> Docker SDK
  |       +--> /var/run/docker.sock
  |       +--> host Docker daemon
  |
  +--> vscode-env-<12-hex> containers
          |
          +--> openvscode-server on port 3000
          +--> /home/workspace bind-mounted from HOST_WORKSPACES_ROOT/<mount_folder>
```

All application containers join the same Docker network, named by `ENV_NETWORK` and usually set to `vscode-manager-net`.

The architecture uses Docker labels as lightweight state:

- `managed-by=vscode-web-env-manager`
- `env-id=<12 hex characters>`
- `mount-folder=<workspace name>`

The backend does not store environment state in a database. Instead, Docker itself is the source of truth.

---

## 4. Main Components And Responsibilities

| Component | Location | Responsibility |
|---|---|---|
| FastAPI app bootstrap | `vscode-web-manager/backend/app/main.py` | Creates the FastAPI app and registers routers. |
| Health routes | `backend/app/api/routes/health.py` | Liveness endpoint. |
| Docker routes | `backend/app/api/routes/docker.py` | Docker daemon connectivity/status endpoint. |
| Environment routes | `backend/app/api/routes/environments.py` | HTTP API for create/list/get/stop/stop-all/remove. |
| Settings | `backend/app/core/config.py` | Loads runtime configuration from environment variables / `.env`. |
| Schemas | `backend/app/schemas/environment.py` | Pydantic request validation. |
| Service layer | `backend/app/services/environment_service.py` | Business logic for environment lifecycle and URL/path construction. |
| Docker gateway | `backend/app/infra/docker_gateway.py` | Wrapper around the Docker Python SDK. |
| React frontend | `vscode-web-manager/frontend/src/` | Dashboard UI and API client. |
| nginx config | `vscode-web-manager/deploy/nginx.conf` | Reverse proxy, SPA serving, dynamic container routing. |
| Compose files | `docker-compose.yml`, `docker-compose.hub.yml` | Local source build and Docker Hub zero-build flows. |
| CI/CD | `.github/workflows/ci.yml` | Backend/frontend checks, Docker image builds, Docker Hub publish. |

---

## 5. Backend Architecture

The backend follows a simple layered structure:

```text
api/routes
  -> services
     -> infra/docker_gateway
        -> Docker daemon
```

### Route Layer

The route layer is intentionally thin. It:

- Receives HTTP requests.
- Lets FastAPI/Pydantic validate request bodies.
- Injects the service through FastAPI dependency injection.
- Maps domain/infrastructure exceptions to HTTP status codes.
- Returns dictionaries as JSON.

Important route file:

```text
backend/app/api/routes/environments.py
```

### Service Layer

The service layer contains the lifecycle logic:

- Create a new environment.
- Reuse an existing environment for the same `mount_folder`.
- Restart stopped containers.
- Remove broken containers if restart fails.
- Resolve safe workspace paths.
- Build public environment URLs.
- List only managed containers.
- Stop one or all environments.

Important service file:

```text
backend/app/services/environment_service.py
```

### Infrastructure Layer

The Docker gateway isolates Docker SDK usage:

```text
backend/app/infra/docker_gateway.py
```

This is a good architectural choice. The service layer does not call `docker.from_env()` directly, which makes the service testable with a fake gateway.

### Configuration Layer

Settings are loaded through `pydantic-settings`:

```python
class Settings(BaseSettings):
    public_base_url: str = "http://localhost:8080"
    env_network: str = "vscode-manager-net"
    host_workspaces_root: str = "/tmp/vscode-workspaces"
    openvscode_image: str = "gitpod/openvscode-server"
```

The main settings are described later in this document.

---

## 6. API Routes

Publicly, API routes are normally accessed through nginx under:

```text
http://localhost:8080/api
```

nginx strips the `/api/` prefix before forwarding to the backend.

### Route Table

| Public route | Backend route | Method | Purpose |
|---|---:|---:|---|
| `/health` | `/health` | GET | Liveness check. |
| `/api/health` | `/health` | GET | Also works because nginx strips `/api/`; Postman uses this form. |
| `/api/docker/info` | `/docker/info` | GET | Checks Docker daemon connectivity and returns basic daemon stats. |
| `/api/environments` | `/environments` | POST | Creates or reuses an environment for a workspace folder. |
| `/api/environments` | `/environments` | GET | Lists managed environments. |
| `/api/environments/{env_id}` | `/environments/{env_id}` | GET | Returns Docker inspect-style details for one environment. |
| `/api/environments/{env_id}/stop` | `/environments/{env_id}/stop` | POST | Stops one environment. |
| `/api/environments/stop-all` | `/environments/stop-all` | POST | Stops all running managed environments and reports successes/failures. |
| `/api/environments/{env_id}` | `/environments/{env_id}` | DELETE | Force-removes one environment container. |

### `GET /health`

Returns:

```json
{ "status": "ok" }
```

This does not check Docker. It only proves the backend process is reachable.

### `GET /docker/info`

Calls Docker through `DockerGateway.docker_info()`.

Returns:

```json
{
  "docker": "connected",
  "server_version": "...",
  "containers": 12,
  "images": 20
}
```

If Docker is unreachable, the route maps `DockerException` to HTTP `502`.

### `POST /environments`

Request:

```json
{ "mount_folder": "demo-project" }
```

Validation:

- Required.
- 1 to 80 characters.
- Must match `^[a-zA-Z0-9_-]+$`.
- No slashes, dots, spaces, or absolute paths.

Response:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
  "workspace_path": "/tmp/vscode-web-manager-workspaces/demo-project",
  "reused": false
}
```

Important behavior:

- If a managed container with the same `mount-folder` label already exists and is running, the service returns it with `reused: true`.
- If one exists but is stopped, the service starts it and returns it with `reused: true`.
- If the existing container cannot be started, the service removes it and creates a fresh one.

### `GET /environments`

Returns a list of managed containers only.

The Docker query filters by:

```text
label=managed-by=vscode-web-env-manager
```

This is an important safety boundary because the backend should not list or manipulate unrelated host containers.

### `GET /environments/{env_id}`

Looks up:

```text
vscode-env-{env_id}
```

Returns container details:

- id
- container name
- status
- image
- labels
- mounts
- Docker networks

Risk to mention: `env_id` is not path-validated as a 12-character hex string in the route. Because the lookup still prefixes the value with `vscode-env-`, the risk is limited, but explicit path validation would make the API contract cleaner.

### `POST /environments/{env_id}/stop`

Stops a single environment and returns the new status.

The workspace folder remains on disk.

### `POST /environments/stop-all`

Iterates over all managed containers:

- Stops running containers.
- Skips already stopped containers.
- Records per-container failures instead of aborting the whole batch.

This is a reasonable design for batch operations because one failure should not prevent the system from attempting the rest.

### `DELETE /environments/{env_id}`

Force-removes the container.

Important: this does not delete the workspace directory on the host. That is a deliberate data-preservation decision.

---

## 7. Service Layer Explanation

The core service is:

```text
EnvironmentService
```

### `create_environment(mount_folder)`

This is the most important method in the backend.

Flow:

1. Acquire a class-level lock for that specific `mount_folder`.
2. Search for an existing managed container with the same `mount-folder` label.
3. Prefer a running container if one exists.
4. If a stopped container exists, try to start it.
5. If start fails, remove the broken container and create a new one.
6. Generate a new environment ID using `uuid.uuid4().hex[:12]`.
7. Resolve and create the workspace directory.
8. Call Docker to start `gitpod/openvscode-server`.
9. Label the container.
10. Attach it to the configured Docker network.
11. Bind-mount the workspace directory into `/home/workspace`.
12. Build and return the public URL.

The lock is stored in a class-level registry, so it survives the fact that FastAPI creates an `EnvironmentService` instance per request. This protects same-folder creates inside one Python process.

### `_resolve_workspace_path(mount_folder)`

This method is a key security control.

It resolves:

```text
HOST_WORKSPACES_ROOT / mount_folder
```

Then it checks that the resolved path is still inside the configured root.

Even though Pydantic already rejects dangerous strings, this second check is valuable because:

- Defense in depth is important around host filesystem access.
- Container labels could theoretically contain values not validated by Pydantic.
- Future code changes may loosen the input schema.

### `_build_environment_url(container_name)`

Builds a URL like:

```text
http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace
```

It uses `PUBLIC_BASE_URL` for the scheme, hostname, and port, then prepends the container name as a subdomain.

Important interview caveat: the Python code can build URLs for non-localhost domains, but the current nginx regex only matches:

```text
vscode-env-<12hex>.localhost
```

So if `PUBLIC_BASE_URL` is changed to `https://demo.example.com`, nginx must also be changed to match `vscode-env-<id>.demo.example.com`.

### `_wait_for_openvscode_ready(container_name)`

When reusing and starting a stopped container, the service probes:

```text
http://<container_name>:3000/
```

from inside the Docker network.

Reason: Docker may report a container as `running` before openvscode-server has bound port `3000`. Without the wait, the frontend could open the URL and receive a transient nginx `502`.

Important caveat: this readiness wait is only used when restarting an existing stopped container. A brand-new environment is returned immediately after Docker starts it. If the user immediately opens the returned URL, there is still a possible short 502 window.

### `stop_all_environments()`

This method catches exceptions per container and returns a summary:

- `stopped_count`
- `skipped_count`
- `failed_count`
- `environments`
- `failures`

This is a practical batch-operation design.

---

## 8. Infrastructure And Docker Integration

The backend uses the Docker Python SDK through:

```text
DockerGateway
```

Main operations:

- `docker.from_env()`
- `client.info()`
- `client.images.get()`
- `client.images.pull()`
- `client.containers.run()`
- `client.containers.list()`
- `client.containers.get()`
- `container.start()`
- `container.stop()`
- `container.remove(force=True)`

The backend container mounts:

```yaml
/var/run/docker.sock:/var/run/docker.sock
```

This means Docker commands issued inside the backend container control the host Docker daemon.

That is powerful and dangerous. In an interview, say this clearly:

> The Docker socket is effectively host-root access. For this assignment and local demo, it is acceptable with narrow API operations and localhost exposure. In production, I would add authentication, authorization, resource limits, and ideally place a constrained Docker API proxy between the backend and the daemon.

### Container Labels

Every created environment gets labels:

```python
{
    "managed-by": "vscode-web-env-manager",
    "env-id": env_id,
    "mount-folder": mount_folder,
}
```

This is the project's main state model and safety boundary.

### Container Names

The service creates containers named:

```text
vscode-env-<12 lowercase hex characters>
```

This is tightly coupled to nginx:

```nginx
server_name "~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$";
```

If the naming format changes, nginx routing must change too.

---

## 9. Configuration And Environment Variables

The main configuration variables are:

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Base URL used to build public environment URLs. |
| `ENV_NETWORK` | `vscode-manager-net` | Docker network used by backend, nginx, and environment containers. |
| `HOST_WORKSPACES_ROOT` | `/tmp/vscode-workspaces` in backend default; `/tmp/vscode-web-manager-workspaces` in `.env.example` / hub compose | Host path where workspace directories are created. |
| `OPENVSCODE_IMAGE` | `gitpod/openvscode-server` | Image used for environment containers. |

### Important Details

`HOST_WORKSPACES_ROOT` must be an absolute host path because the backend passes that path to the host Docker daemon through the Docker socket.

The Compose file uses a 1:1 bind mount:

```yaml
${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}
```

This avoids path translation between:

- The path seen by the backend container.
- The path interpreted by the host Docker daemon.

### Configuration Risk

There is a minor consistency issue: the backend default for `host_workspaces_root` is `/tmp/vscode-workspaces`, while `.env.example` and `docker-compose.hub.yml` use `/tmp/vscode-web-manager-workspaces`. This is not a runtime bug when Compose passes explicit env vars, but it is something an interviewer may notice. A clean improvement would be to align all defaults.

---

## 10. Dockerfile Explanation

### Backend Dockerfile

Location:

```text
vscode-web-manager/backend/Dockerfile
```

It uses:

```dockerfile
FROM python:3.12-slim
```

Important choices:

- `PYTHONDONTWRITEBYTECODE=1`: avoids `.pyc` files.
- `PYTHONUNBUFFERED=1`: logs appear immediately in Docker logs.
- `PIP_NO_CACHE_DIR=1`: smaller image.
- `COPY requirements.txt` before `COPY app`: improves Docker layer caching.
- Runs uvicorn on `0.0.0.0:8000`.

Interview point:

> The backend image is intentionally small and simple, but it does not yet run as a non-root user. For production, I would add a non-root user and tighten filesystem permissions.

### Frontend Dockerfile

Location:

```text
vscode-web-manager/frontend/Dockerfile
```

It is a multi-stage build:

1. Build stage: `node:20-alpine`
   - Installs dependencies with `npm ci`.
   - Runs `npm run build`.
2. Runtime stage: `nginx:1.27-alpine`
   - Copies Vite `dist/` output into `/usr/share/nginx/html`.

This is a good pattern because the runtime image does not contain Node.js, source files, or `node_modules`.

---

## 11. Docker Compose Explanation

### `docker-compose.yml`

This is the source-build local development flow.

Services:

- `backend`
- `nginx`

The backend:

- Builds from `./backend`.
- Mounts the Docker socket.
- Mounts the workspace root.
- Receives env vars explicitly.
- Joins the manager network.

The nginx service:

- Builds from the repo root using `frontend/Dockerfile`.
- Publishes host port `8080` to container port `80`.
- Uses the nginx config baked into the frontend/nginx image from `deploy/nginx.conf`.
- Depends on backend startup.
- Joins the same network.

Important caveat:

`depends_on` only controls startup order. It does not wait for backend readiness. A more production-ready Compose file would add healthchecks and `condition: service_healthy`.

### `docker-compose.hub.yml`

This is the zero-build reviewer flow.

Instead of `build:`, it uses:

```yaml
image: docker.io/lior8289/vscode-web-manager-backend:latest
image: docker.io/lior8289/vscode-web-manager-frontend:latest
```

It also provides default env var values, making the reviewer flow easier.

Interview risk:

Using `latest` is convenient for demos but not ideal for production. A production deployment should pin immutable tags, such as the CI-generated `sha-<short>` tag.

---

## 12. nginx Explanation

Location:

```text
vscode-web-manager/deploy/nginx.conf
```

This config is copied into the runtime image by `frontend/Dockerfile`:

```dockerfile
COPY deploy/nginx.conf /etc/nginx/nginx.conf
```

Older versions of the project kept or mounted nginx config closer to the frontend. The current version keeps it in `deploy/` because nginx is the app gateway, then packages the config into the frontend/nginx image so reviewer images are self-contained.

nginx has two main virtual hosts.

### `localhost`

Handles:

- `/health`
- `/api/`
- React SPA fallback

Important detail:

```nginx
location /api/ {
    proxy_pass http://backend:8000/;
}
```

The trailing slash matters. It causes nginx to strip `/api/`, so:

```text
/api/environments -> /environments
```

### `vscode-env-<id>.localhost`

Handles editor traffic:

```nginx
server_name "~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$";
```

The named capture group becomes:

```text
$vscode_container
```

Then nginx proxies to:

```nginx
proxy_pass http://$vscode_container:3000;
```

This works because nginx and the environment containers share the same Docker network, and Docker embedded DNS can resolve container names.

### Docker DNS

The config includes:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
```

`127.0.0.11` is Docker's embedded DNS server on user-defined networks.

This is required because environment containers are created dynamically after nginx has already started.

### WebSocket Support

openvscode-server requires WebSockets for editor functionality.

nginx forwards upgrade headers:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Without these, the editor may load partially but terminals/language features can fail.

---

## 13. CI/CD GitHub Actions Explanation

CI file:

```text
vscode-web-manager/.github/workflows/ci.yml
```

Triggers:

- `push`
- `pull_request`

### `backend-checks`

Runs:

1. Checkout.
2. Set up Python 3.12.
3. Install backend dependencies.
4. `ruff check`.
5. `pytest`.
6. Build backend Docker image.
7. Validate Docker Compose config.

### `frontend-checks`

Runs:

1. Checkout.
2. Set up Node.js 20.
3. Install frontend dependencies with `npm ci`.
4. Run `npm run lint`.
5. Run `npm run typecheck`.
6. Run `npm run build`.
7. Build frontend Docker image.

### `publish-images`

Runs only when:

- The event is `push`.
- The branch is `main`.
- Both check jobs passed.

It:

- Sets up QEMU.
- Sets up Docker Buildx.
- Logs into Docker Hub using secrets.
- Builds multi-arch images for `linux/amd64` and `linux/arm64`.
- Pushes `latest` and `sha-<short>` tags.
- Uses GitHub Actions layer caching.

This is a solid CI/CD story for an assignment project. The docs now match the workflow: backend checks, frontend checks, and the gated Docker Hub publish job.

---

## 14. Testing Strategy

Backend tests are under:

```text
vscode-web-manager/backend/tests/
```

There are 36 backend tests.

### Test Types

| Test file | Purpose |
|---|---|
| `test_schemas.py` | Validates Pydantic input constraints. |
| `test_environment_service.py` | Tests lifecycle logic with fake Docker objects. |
| `test_environments_routes.py` | Tests HTTP route behavior with a fake service. |
| `test_health.py` | Tests health endpoint. |
| `conftest.py` | Provides test settings through monkeypatching. |

### Good Testing Decisions

- The service layer is tested without a real Docker daemon.
- `FakeDockerGateway` makes reuse, stop, remove, and failure paths testable.
- Route tests use `app.dependency_overrides`.
- Workspace path creation is tested using `tmp_path`.
- Schema tests protect the `mount_folder` validation contract.
- Concurrency tests verify that simultaneous creates for the same `mount_folder` provision only one container in a single backend process.

### Gaps

The project does not yet have:

- Real Docker integration tests.
- nginx routing tests.
- openvscode-server readiness tests against the real image.
- Frontend component tests.
- Browser/e2e tests with Playwright or Cypress.
- CI test that boots the full Compose stack and creates an environment.

For an interview, say:

> The current tests are strong unit and route tests, intentionally hermetic and fast. They give good confidence in the service logic, but I would add a small end-to-end Compose test before calling this production-ready.

### Verification Performed During This Review

Using the checked-in backend virtualenv and installed frontend dependencies:

```text
backend: .venv/bin/python -m ruff check .     -> passed
backend: .venv/bin/python -m pytest           -> 36 passed
frontend: npm run lint                        -> passed
frontend: npm run typecheck                   -> passed
frontend: npm run build                       -> passed
docker compose config --quiet                 -> passed
docker compose -f docker-compose.hub.yml config --quiet -> passed
```

The global Python environment was missing project dependencies, so direct `python -m pytest` outside the project virtualenv failed with `ModuleNotFoundError: docker`. That is an environment issue, not an application test failure.

---

## 15. Error Handling Strategy

### Current Strategy

The routes convert some service/infrastructure failures into HTTP status codes:

| Error | Current mapping |
|---|---|
| Pydantic validation failure | `422` automatically by FastAPI |
| Workspace path escapes root | `400` |
| Docker API conflict during create | `409` |
| Docker API/Docker daemon error during create | `502` |
| Docker daemon error in `/docker/info` | `502` |
| Environment not found | `404` |
| Stop-all per-container failure | Captured in response `failures` |

### Important Weakness

Not all Docker exceptions are consistently mapped. For example:

- `list_environments()` can raise Docker exceptions, but the route does not catch them.
- `get_environment()`, `stop_environment()`, and `remove_environment()` catch not-found but not other Docker failures.

That means some Docker errors can surface as HTTP `500` instead of `502`.

Professional answer:

> I intentionally kept route handlers narrow, but I would improve consistency by adding a small exception-mapping helper or FastAPI exception handler for Docker exceptions. That would preserve the thin-route style while making Docker failures consistently return 502.

---

## 16. Important Design Decisions

### 1. `mount_folder` Is A Name, Not An Arbitrary Host Path

This is one of the most defensible design choices.

The assignment may suggest a path-like parameter, but accepting arbitrary host paths through an unauthenticated API is dangerous. This project accepts a safe folder name and resolves it under `HOST_WORKSPACES_ROOT`.

Be ready to say:

> I deliberately constrained the input to a workspace name instead of accepting arbitrary host paths. Since the backend has Docker socket access and can bind-mount host paths, arbitrary paths would create a serious host filesystem exposure.

### 2. Docker Labels Are The State Store

No database is used.

The Docker daemon is the source of truth, and labels identify managed containers.

This is good for a local tool because it reduces moving parts. It is weaker for distributed production systems because Docker labels do not give strong transactional guarantees.

### 3. nginx Subdomain Routing

The system uses container names as subdomains:

```text
vscode-env-abc123def456.localhost
```

nginx extracts the container name and proxies to it directly.

This is elegant because it avoids allocating host ports per environment.

Tradeoff: URL construction, container naming, nginx regex, and Docker network membership are tightly coupled.

### 4. One nginx Service For SPA And Reverse Proxy

The frontend is built into the nginx runtime image. nginx serves:

- Static React assets.
- API proxy.
- Environment proxy.

This keeps deployment simple and avoids CORS.

### 5. Service/Gateway Separation

Docker SDK usage is isolated in `DockerGateway`.

This makes the service easier to test and explain.

### 6. Idempotent Create

Creating an environment with the same `mount_folder` reuses an existing container.

This avoids duplicate containers for the same workspace in normal retries.

The current implementation also adds a class-level per-`mount_folder` lock, so simultaneous create requests for the same folder are serialized inside a single backend process. This is a good local-process fix and is covered by concurrency tests.

Remaining weakness: the lock is in memory. If the backend runs with multiple worker processes, multiple replicas, or multiple hosts, it would need a distributed lock or a persistent uniqueness constraint.

---

## 17. Security Considerations

### Positive Security Decisions

- Backend is not directly published to the host in Docker Compose.
- API is accessed through nginx.
- `mount_folder` is tightly validated.
- Path containment is checked after resolving paths.
- The backend filters lifecycle operations by `managed-by` label.
- Environment containers are not given individual host ports.
- Frontend and API are same-origin, so CORS is avoided.

### Major Security Risks

1. Docker socket is mounted into the backend.
   - This is effectively host-root power.
   - It is acceptable for a local assignment demo, not for untrusted public use.

2. No authentication or authorization.
   - Anyone who can access the UI/API can create and manage environments.
   - For public deployment, add auth at nginx or in FastAPI.

3. openvscode-server exposure.
   - Environment URLs may expose editor access without user authentication, depending on image/runtime configuration.
   - For production, require per-user auth and session isolation.

4. No resource limits.
   - A user can create many containers.
   - A single container can consume excessive CPU/memory.

5. Backend likely runs as root in its container.
   - Production hardening should add a non-root user and tighter permissions.

6. No rate limiting.
   - A client could repeatedly create environments and exhaust host resources.

---

## 18. Scalability Considerations

### What Scales Reasonably

- Multiple environment containers can run at once.
- nginx can route to containers dynamically using Docker DNS.
- The backend does not need a database for simple local usage.
- No per-container host port allocation is needed.

### What Does Not Scale Well Yet

- First image pull happens synchronously during an API request.
- Docker SDK calls are synchronous.
- No worker tuning is configured for uvicorn.
- Same-folder duplicate creation is protected only within one backend process; multi-worker or multi-replica deployments still need distributed coordination.
- No resource limits are applied to environment containers.
- No automatic cleanup/reaper for idle environments.
- State stored only in Docker labels limits observability and querying.
- No multi-host orchestration; everything assumes one Docker host.

### Production Direction

For a larger system, consider:

- Kubernetes or Nomad for scheduling.
- Persistent database for environment state.
- Queue-based provisioning.
- Per-user authentication and authorization.
- CPU/memory/pid limits.
- Idle timeout and cleanup jobs.
- Health checks and readiness probes.
- Metrics and structured logging.
- Immutable image tags instead of `latest`.

---

## 19. Limitations And Possible Improvements

### Interview-Risky Weak Points

1. No authentication.
2. Docker socket exposure.
3. No resource limits on created containers.
4. No end-to-end test that boots Compose and opens a real environment.
5. No frontend tests.
6. Route response models are not enforced with `response_model`.
7. `EnvironmentResponse` schema is unused and incomplete relative to actual responses.
8. Some Docker errors can become `500` instead of `502`.
9. Same-folder concurrency protection is in-memory and single-process only.
10. New environment creation does not wait for openvscode readiness, while restarted reuse does.
11. `PUBLIC_BASE_URL` supports arbitrary hosts in Python, but nginx only matches `.localhost`.
12. `env_id` path parameter is not explicitly constrained to 12 hex characters.
13. No Compose healthchecks.
14. `frontend/README.md` is still the default Vite template and should be replaced.
15. Parent-level `QA.md` contains stale CI information compared with the actual workflow.
16. Backend/default workspace root differs from `.env.example` / hub compose default.
17. Docker Hub compose uses `latest`, convenient but not reproducible.
18. No observability beyond logs and endpoint responses.

### Practical Improvements

- Add auth to nginx or FastAPI.
- Add per-container CPU/memory/pids limits.
- Replace the in-memory per-`mount_folder` lock with distributed coordination if running multiple backend workers/replicas.
- Add route-level `response_model`s.
- Add Docker exception handlers.
- Add `env_id` route validation.
- Add Compose healthchecks.
- Add Playwright smoke test for dashboard and nginx routing.
- Add one CI integration job that boots Compose and hits `/health`, `/docker/info`, and create/list/delete.
- Add a background cleanup process for stale environments.
- Replace `frontend/README.md` with project-specific frontend documentation.
- Align configuration defaults.
- Make nginx domain pattern configurable for non-localhost deployments.

---

## 20. How To Explain The Project In An Interview

### Short 1-Minute Explanation

This project is a local web manager for browser-based VS Code environments. A React dashboard lets the user create a workspace by name. The FastAPI backend validates that name, creates or reuses an `openvscode-server` Docker container, bind-mounts a host workspace folder into `/home/workspace`, labels the container, and returns a URL. nginx is the public entry point: it serves the dashboard, proxies `/api/*` to the backend, and uses a regex subdomain like `vscode-env-abc123def456.localhost` to route editor traffic to the right container over Docker DNS. The backend only manages containers with its own label, and the project has unit/route tests, Docker Compose, and GitHub Actions that build, test, lint, and publish images.

### Deeper 3-5 Minute Explanation

The system has three main runtime parts: nginx, a FastAPI backend, and dynamically created openvscode-server containers. nginx is the only public service on port `8080`. It serves the built React dashboard, forwards `/api/` traffic to the backend, and routes editor traffic based on subdomains.

When a user creates an environment, the frontend sends `POST /api/environments` with a `mount_folder`. The backend validates that this is only a safe folder name, not an arbitrary host path. The service then checks Docker for a managed container with the same `mount-folder` label. If it finds one, it reuses it; if it is stopped, it starts it. If no usable container exists, it creates a new one named `vscode-env-<12hex>`, attaches it to the same Docker network as nginx, bind-mounts `HOST_WORKSPACES_ROOT/<mount_folder>` into `/home/workspace`, and labels it.

The returned URL uses the container name as a subdomain. nginx has a regex `server_name` that captures that container name and proxies to `http://<container_name>:3000`. Because nginx and the environment containers are on the same Docker network, Docker embedded DNS resolves the container name dynamically.

The backend is layered: routes are thin and map errors to HTTP responses, the service layer owns lifecycle rules, and `DockerGateway` is the only place that imports the Docker SDK. Tests use fakes at the gateway and service boundaries, so most logic is tested without needing a real Docker daemon.

The key tradeoff is that this is a local assignment-style system, not a hardened multi-user platform. The Docker socket is mounted into the backend, which is powerful but dangerous. The design mitigates some risk through input validation, path containment, and label scoping, but production would require authentication, resource limits, a safer Docker control plane, healthchecks, end-to-end tests, and observability.

---

## 21. Technical Terms To Be Ready To Explain

- FastAPI
- ASGI
- Uvicorn
- Pydantic validation
- `pydantic-settings`
- Dependency injection in FastAPI
- Docker daemon
- Docker socket
- Docker Python SDK / docker-py
- Docker image vs container
- Bind mount
- Docker network
- Docker embedded DNS (`127.0.0.11`)
- Container labels
- Reverse proxy
- nginx `server_name`
- nginx regex capture group
- WebSocket upgrade headers
- SPA fallback
- Docker Compose
- Multi-stage Docker build
- GitHub Actions
- Docker Buildx
- Multi-architecture images
- CI vs CD
- Unit test vs integration test vs end-to-end test
- Idempotency
- Path traversal
- Readiness vs liveness
- Resource limits
- Authentication vs authorization

---

## 22. Realistic Interview Question Bank

The questions below move from high-level to more difficult and specific. Practice answering them out loud.

### 1. What does this project do?

**What the interviewer is checking:** Whether you can explain the system without diving into implementation details too early.

**Strong answer:** It is a local web manager for browser-based VS Code environments. The user creates a workspace from a React dashboard, the FastAPI backend provisions or reuses an `openvscode-server` Docker container, nginx exposes it through a subdomain, and the workspace is persisted through a host bind mount.

**Follow-up questions:** Why use containers? What is openvscode-server? What is persisted and what is disposable?

### 2. What are the main runtime components?

**What the interviewer is checking:** Your architecture map.

**Strong answer:** nginx is the public entry point, the FastAPI backend manages environment lifecycle through Docker, and each environment is an openvscode-server container. The React app is built into the nginx image and served as static files.

**Follow-up questions:** Which ports are exposed? Which service talks to Docker? Why is the backend not directly exposed?

### 3. Walk me through environment creation end to end.

**What the interviewer is checking:** Whether you understand the full request path.

**Strong answer:** Browser sends `POST /api/environments` to nginx. nginx strips `/api/` and forwards to FastAPI. FastAPI validates `mount_folder`. The service checks for an existing labeled container for that folder, reuses or starts it if possible, otherwise creates a new container with labels, network, and bind mount. It returns the container ID, status, URL, and workspace path.

**Follow-up questions:** What happens if the image is missing? What happens if Docker is down? What happens if the same folder already exists?

### 4. Why did you use FastAPI?

**What the interviewer is checking:** Framework reasoning.

**Strong answer:** FastAPI is a good fit because Pydantic validation, dependency injection, and OpenAPI documentation are built in. For this project, request validation and clean test overrides are especially useful. It lets route handlers stay thin while the service layer owns the Docker lifecycle.

**Follow-up questions:** How would this look in Flask? What does FastAPI return on validation failure?

### 5. How is the backend structured?

**What the interviewer is checking:** Code organization.

**Strong answer:** It is layered. `api/routes` handles HTTP concerns, `services/environment_service.py` owns business logic, `infra/docker_gateway.py` wraps the Docker SDK, `schemas` contains Pydantic models, and `core/config.py` contains settings.

**Follow-up questions:** Why isolate Docker SDK calls? How do tests use that separation?

### 6. What does the service layer do?

**What the interviewer is checking:** Whether you can distinguish business logic from HTTP logic.

**Strong answer:** The service layer creates, lists, inspects, stops, stops all, and removes environments. It also enforces workspace path containment, handles reuse by label, builds public URLs, and coordinates with Docker through the gateway.

**Follow-up questions:** Why not put this logic in the route handlers? What exceptions does the service raise?

### 7. What is `DockerGateway` and why is it useful?

**What the interviewer is checking:** Abstraction and testability.

**Strong answer:** `DockerGateway` is a thin wrapper around the Docker Python SDK. It centralizes Docker operations and keeps the service from importing `docker` directly. That makes service tests easy because we can pass a fake gateway instead of a real Docker daemon.

**Follow-up questions:** Is this over-engineering? What methods does it expose?

### 8. How does nginx route to the right editor container?

**What the interviewer is checking:** Reverse proxy and DNS understanding.

**Strong answer:** Environment containers are named `vscode-env-<12hex>`. nginx has a regex `server_name` that matches `vscode-env-<12hex>.localhost` and captures the container name. It then proxies to `http://$vscode_container:3000`. Docker DNS resolves that name because nginx and the environment container share a Docker network.

**Follow-up questions:** Why is `resolver 127.0.0.11` needed? What breaks if the container name format changes?

### 9. Why is there no host port per environment?

**What the interviewer is checking:** Networking design.

**Strong answer:** nginx routes by subdomain and proxies over the Docker network, so each environment can listen on port `3000` internally. This avoids allocating and tracking random host ports for every environment.

**Follow-up questions:** What are the tradeoffs of subdomain routing? How would this work outside localhost?

### 10. What is Docker embedded DNS?

**What the interviewer is checking:** Docker networking depth.

**Strong answer:** On user-defined Docker networks, containers can resolve each other by container name through Docker's embedded DNS server at `127.0.0.11`. nginx uses that resolver to resolve newly created environment containers dynamically.

**Follow-up questions:** Why does nginx need an explicit resolver? What happens on the default bridge network?

### 11. Why restrict `mount_folder` instead of accepting any host path?

**What the interviewer is checking:** Security judgment.

**Strong answer:** The backend has Docker socket access and can bind-mount host paths, so accepting arbitrary paths would expose the host filesystem. I accept a safe folder name and resolve it under `HOST_WORKSPACES_ROOT`, with both schema validation and a resolved-path containment check.

**Follow-up questions:** What attacks does this prevent? Is the resolved-path check still needed?

### 12. How does path traversal protection work?

**What the interviewer is checking:** Concrete implementation knowledge.

**Strong answer:** Pydantic rejects values with dots, slashes, spaces, and empty strings. Then `_resolve_workspace_path` resolves the target path and verifies it is equal to or inside the configured root. This protects against traversal even if future validation changes.

**Follow-up questions:** What about symlinks? What if the value comes from a Docker label?

### 13. How does idempotency work?

**What the interviewer is checking:** API design maturity.

**Strong answer:** `POST /environments` first searches for a managed container with the same `mount-folder` label. If it exists, the service returns it or starts it instead of creating another. The response includes `reused` so the client knows whether it was newly provisioned or reused.

**Follow-up questions:** Is POST normally idempotent? Can concurrent requests still create duplicates?

### 14. Can two simultaneous requests create duplicate environments?

**What the interviewer is checking:** Whether you can identify race conditions.

**Strong answer:** In the current single-process backend, the service uses a class-level per-folder lock, so two simultaneous requests for the same `mount_folder` are serialized and only one container is provisioned. The limitation is that this is an in-memory process-local lock. If I run multiple uvicorn worker processes, multiple backend replicas, or multiple hosts, I still need distributed coordination or a database uniqueness constraint.

**Follow-up questions:** Why class-level? Would it work with multiple backend workers? How would you implement a distributed lock?

### 15. What are the biggest security risks?

**What the interviewer is checking:** Honesty and production awareness.

**Strong answer:** The Docker socket is the biggest risk because it effectively grants host-root power. There is also no authentication, no rate limiting, no resource limits, and editor containers may be reachable without per-user auth. The current mitigations are local exposure, narrow APIs, input validation, path containment, and label scoping.

**Follow-up questions:** How would you harden it? What is a Docker socket proxy?

### 16. Why is the Docker socket mounted?

**What the interviewer is checking:** Whether you understand the deployment model.

**Strong answer:** The backend needs to create sibling containers on the host Docker daemon. Mounting `/var/run/docker.sock` lets the Docker SDK inside the backend communicate with the host daemon. Without it, the backend could not start openvscode containers.

**Follow-up questions:** What alternatives exist? Why not Docker-in-Docker?

### 17. What does the `managed-by` label protect?

**What the interviewer is checking:** Trust boundary understanding.

**Strong answer:** It scopes list/stop/remove operations to containers this application owns. The backend asks Docker for containers with `managed-by=vscode-web-env-manager`, so unrelated host containers are not listed or modified by normal lifecycle operations.

**Follow-up questions:** Could a malicious user create a container with that label? How would you handle multi-tenant trust?

### 18. Why use `restart: unless-stopped`?

**What the interviewer is checking:** Docker lifecycle reasoning.

**Strong answer:** `unless-stopped` restarts containers after crashes or host reboots but respects an explicit stop. If we used `always`, a container stopped through the API could be restarted by Docker, making the stop endpoint misleading.

**Follow-up questions:** What happens after host reboot? Does this apply to environment containers too?

### 19. How does the frontend communicate with the backend?

**What the interviewer is checking:** Frontend/backend integration.

**Strong answer:** The frontend uses a small API client with `BASE = '/api'`. In production, nginx forwards `/api/*` to FastAPI. In Vite dev mode, the Vite proxy rewrites `/api` to `localhost:8000`.

**Follow-up questions:** Why no CORS? What library manages server state?

### 20. Why use TanStack Query?

**What the interviewer is checking:** Frontend state reasoning.

**Strong answer:** The dashboard is server-state heavy: Docker info, environment list, and details are polled. TanStack Query handles polling, caching, loading/error states, mutations, and invalidation after operations like create, stop, and remove.

**Follow-up questions:** What are the polling intervals? What would you change for WebSockets?

### 21. What does the CI pipeline do?

**What the interviewer is checking:** DevOps awareness.

**Strong answer:** It has backend checks, frontend checks, and a publish job. Backend checks install Python dependencies, run ruff, pytest, build the backend image, and validate Compose. Frontend checks install npm dependencies, lint, typecheck, build, and build the frontend image. On pushes to `main`, it publishes multi-arch Docker images to Docker Hub.

**Follow-up questions:** Why separate jobs? Why publish only on main?

### 22. What is the difference between `docker-compose.yml` and `docker-compose.hub.yml`?

**What the interviewer is checking:** Deployment path clarity.

**Strong answer:** `docker-compose.yml` builds images from local source, useful for development. `docker-compose.hub.yml` uses prebuilt Docker Hub images and defaults, useful for reviewers who want to run the project without building.

**Follow-up questions:** Why is `latest` risky? How would you pin versions?

### 23. What tests exist?

**What the interviewer is checking:** Test coverage.

**Strong answer:** Backend tests cover schemas, service logic with fake Docker objects, route behavior with a fake service, health, and the new same-folder concurrency behavior. They are fast and hermetic; the suite has 36 tests.

**Follow-up questions:** What is not tested? How would you add e2e coverage?

### 24. Why are there fake Docker classes in tests?

**What the interviewer is checking:** Testing strategy.

**Strong answer:** They let service tests exercise lifecycle logic without requiring Docker. The fake gateway can simulate containers, statuses, start failures, stop failures, and managed/unmanaged labels.

**Follow-up questions:** What would an integration test add? Are fakes risky?

### 25. How are errors mapped to HTTP responses?

**What the interviewer is checking:** API reliability.

**Strong answer:** Validation errors become 422 automatically. Service `ValueError` for path containment becomes 400. Not-found becomes 404. Docker conflict during create becomes 409. Docker errors during create and Docker info become 502. Stop-all records per-container failures in its response.

**Follow-up questions:** Are all Docker errors consistently mapped? What improvement would you make?

### 26. Why are route responses plain dicts instead of Pydantic response models?

**What the interviewer is checking:** Contract awareness.

**Strong answer:** The current implementation returns service dictionaries directly, which is simple and works. The downside is weaker OpenAPI response contracts. A good improvement would be to add `response_model` definitions for each route and update the existing unused `EnvironmentResponse` schema.

**Follow-up questions:** What bugs can response models catch? What is the runtime cost?

### 27. What happens if `PUBLIC_BASE_URL` is changed to a real domain?

**What the interviewer is checking:** Configuration coupling.

**Strong answer:** The backend will build URLs under that domain, but nginx currently only matches `vscode-env-<id>.localhost`. For a real domain, nginx must be updated to match that domain, DNS/wildcard records must point to nginx, and TLS must be configured.

**Follow-up questions:** How would you support HTTPS? Would you need wildcard certificates?

### 28. How would you make this production-ready?

**What the interviewer is checking:** Ability to move from assignment to real system.

**Strong answer:** I would add authentication, authorization, resource limits, rate limiting, structured logging, metrics, healthchecks, end-to-end tests, a safer Docker API proxy, immutable image tags, idle cleanup, and concurrency control. For multi-host scale, I would consider Kubernetes or another scheduler instead of directly controlling one Docker daemon.

**Follow-up questions:** What would you do first? What is the highest-risk production gap?

### 29. What is the first thing likely to break under load?

**What the interviewer is checking:** Scalability reasoning.

**Strong answer:** Host resources and synchronous provisioning. openvscode containers are relatively heavy, image pulls are large, and there are no CPU/memory limits. Also, synchronous Docker calls and readiness waits can occupy backend workers. I would pre-pull images, add quotas, tune workers, and eventually move provisioning to a queue.

**Follow-up questions:** How many users can it support today? How would you measure it?

### 30. If you had one day to improve the project before production review, what would you change?

**What the interviewer is checking:** Prioritization.

**Strong answer:** I would first add authentication and resource limits because they reduce the largest operational risks. Then I would add consistent Docker exception handling, `response_model`s, env-id validation, Compose healthchecks, and one e2e CI smoke test that boots Compose and creates/deletes an environment.

**Follow-up questions:** Why not start with refactoring? Which change gives the highest confidence boost?

---

## 23. Final Interview Advice

Be direct about the tradeoffs. The project has a clean and explainable architecture, but the strongest interview performance will come from showing that you understand both what is solid and what is risky.

The strongest framing is:

> This is a well-scoped local environment manager. The architecture intentionally separates HTTP, service logic, and Docker infrastructure; nginx handles dynamic routing without per-container host ports; Docker labels are used as a lightweight state model; and the test suite covers the backend behavior without requiring Docker. For production, the main work would be security hardening, resource governance, concurrency control, and end-to-end coverage.
