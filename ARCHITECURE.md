# Architecture: VS Code Web Environment Manager

This document explains the project architecture at a professional high level, with technical interview follow-up questions after each major section.

Project implementation lives under:

```text
vscode-web-manager/
```

---

## 1. Executive Summary

VS Code Web Environment Manager is a local container orchestration application that creates browser-accessible VS Code environments on demand.

The user interacts with a React dashboard served by nginx. The dashboard calls a FastAPI backend. The backend uses the Docker SDK through the host Docker socket to create and manage `openvscode-server` containers. nginx routes each editor environment through a subdomain based on the container name.

The system is designed around a small number of clear responsibilities:

- nginx is the public entry point and reverse proxy.
- FastAPI is the control plane API.
- Docker is the runtime and state source for environment containers.
- React is the user-facing management dashboard.
- Host bind mounts preserve workspace data outside the container lifecycle.

This is a strong architecture for a local assignment or single-host developer tool. It is not fully production-ready without authentication, resource limits, stronger Docker isolation, distributed coordination, and end-to-end operational checks.

### Interview Follow-Up Questions

1. How would you summarize this project in one minute?
2. What are the runtime components?
3. What is the difference between the control plane and the data/editor plane?
4. Why is this architecture suitable for a local tool but not yet production-hardened?

---

## 2. Core Problem

The project solves the problem of creating isolated browser-based development environments without manually managing Docker containers, ports, volumes, and URLs.

Without this system, a user would need to:

- Pull an editor image.
- Run a container manually.
- Choose a host port.
- Bind-mount a workspace.
- Track container names and lifecycle.
- Stop/remove containers manually.

With this system, the user creates an environment with a simple workspace name, and the system handles provisioning, routing, persistence, and lifecycle operations.

### Interview Follow-Up Questions

1. What manual Docker workflow does this project automate?
2. Why is browser-based VS Code useful?
3. What does the system isolate, and what does it persist?
4. What problem does nginx solve in this architecture?

---

## 3. High-Level Architecture Diagram

```text
User Browser
   |
   | http://localhost:8080
   v
+--------------------------------------------------+
| nginx container                                  |
|                                                  |
|  1. Serves React dashboard                       |
|  2. Proxies /api/* to FastAPI backend            |
|  3. Routes vscode-env-<id>.localhost to editors  |
+-------------------+------------------------------+
                    |
                    | /api/*
                    v
          +----------------------+
          | FastAPI backend      |
          |                      |
          | routes               |
          | services             |
          | DockerGateway        |
          +----------+-----------+
                     |
                     | /var/run/docker.sock
                     v
          +----------------------+
          | Host Docker daemon   |
          +----------+-----------+
                     |
                     | creates/starts/stops/removes
                     v
          +------------------------------+
          | vscode-env-<12hex> container |
          |                              |
          | openvscode-server :3000      |
          | /home/workspace              |
          +---------------+--------------+
                          |
                          | bind mount
                          v
          HOST_WORKSPACES_ROOT/<mount_folder>
```

### Key Architectural Idea

The backend does not directly serve editor traffic. It only manages containers. nginx serves as the stable public gateway for both the dashboard/API and the dynamically created editor containers.

### Interview Follow-Up Questions

1. Walk me through a request from the browser to the editor container.
2. Why does the backend not proxy editor traffic itself?
3. Why is nginx a good fit here?
4. What would change if each environment used a separate host port instead of subdomains?

---

## 4. Runtime Components

### 4.1 nginx

nginx is the only service published to the host on port `8080`.

Responsibilities:

- Serve the React SPA.
- Proxy `/api/*` requests to the FastAPI backend.
- Proxy `vscode-env-<12hex>.localhost` requests to the matching openvscode container.
- Preserve WebSocket upgrade headers for editor functionality.

Config location:

```text
vscode-web-manager/deploy/nginx.conf
```

The config lives under `deploy/` because nginx is the public gateway for the whole app, not only the React frontend. It is copied into the frontend/nginx runtime image by `frontend/Dockerfile`:

```dockerfile
COPY deploy/nginx.conf /etc/nginx/nginx.conf
```

The frontend Docker build uses the repo root as its build context so it can copy both `frontend/` source files and `deploy/nginx.conf`.

### 4.2 FastAPI Backend

The backend is the control plane.

Responsibilities:

- Validate API input.
- Create/reuse/inspect/stop/remove environment containers.
- Resolve safe workspace paths.
- Build public environment URLs.
- Apply label-based ownership rules.
- Communicate with Docker through the Docker SDK.

### 4.3 Docker Daemon

Docker is the runtime substrate.

Responsibilities:

- Run backend and nginx containers.
- Run per-environment editor containers.
- Provide embedded DNS on the shared Docker network.
- Store container labels and runtime status.
- Manage bind mounts.

### 4.4 openvscode-server Containers

Each development environment is a separate container:

```text
vscode-env-<12hex>
```

Responsibilities:

- Run browser-accessible VS Code.
- Expose editor service on internal port `3000`.
- Mount the host workspace into `/home/workspace`.

### 4.5 React Frontend

The frontend is a dashboard for the backend API.

Responsibilities:

- List environments.
- Create new environments.
- Open editor URLs.
- Stop/remove environments.
- Show Docker connectivity and environment details.

### Interview Follow-Up Questions

1. Which component is the public entry point?
2. Which component has access to the Docker socket?
3. Which component serves WebSocket traffic?
4. Why is the frontend served from nginx instead of a Node server in production?

---

## 5. Backend Layered Architecture

The backend follows a simple layered design:

```text
API routes
   |
   v
Service layer
   |
   v
Docker gateway
   |
   v
Docker daemon
```

### 5.1 API Routes

Location:

```text
vscode-web-manager/backend/app/routes/
```

Route files:

- `health.py`
- `docker.py`
- `environments.py`

The route layer handles:

- HTTP request/response boundaries.
- FastAPI dependency injection.
- HTTP status code mapping.
- Pydantic request parsing.

The route layer should stay thin. It should not contain Docker lifecycle logic.

### 5.2 Service Layer

Location:

```text
vscode-web-manager/backend/app/service.py
```

The service layer owns business logic:

- Environment creation.
- Environment reuse.
- Per-folder locking.
- Workspace path resolution.
- Container labeling.
- Environment URL construction.
- Stop/remove/list behavior.

The service raises domain-level exceptions such as `EnvironmentNotFoundError`.

### 5.3 Infrastructure Layer

Location:

```text
vscode-web-manager/backend/app/docker_gateway.py
```

`DockerGateway` is the only layer that directly imports and wraps the Docker SDK.

Benefits:

- Keeps Docker-specific code isolated.
- Makes service logic testable.
- Allows fake Docker gateways in tests.
- Avoids coupling route handlers to Docker SDK details.

### 5.4 Configuration Layer

Location:

```text
vscode-web-manager/backend/app/config.py
```

Settings are loaded with `pydantic-settings`.

Main settings:

- `PUBLIC_BASE_URL`
- `ENV_NETWORK`
- `HOST_WORKSPACES_ROOT`
- `OPENVSCODE_IMAGE`

### Interview Follow-Up Questions

1. Why separate routes, services, and infrastructure?
2. Why should only `DockerGateway` import the Docker SDK?
3. What is the role of FastAPI dependency injection here?
4. Why raise `EnvironmentNotFoundError` instead of `HTTPException` from the service?

---

## 6. Environment Creation Flow

When the user creates an environment:

```http
POST /api/environments
Content-Type: application/json

{ "mount_folder": "demo" }
```

The flow is:

1. Browser sends the request to nginx.
2. nginx forwards `/api/environments` to backend route `/environments`.
3. FastAPI validates the request body with Pydantic.
4. The route calls `EnvironmentService.create_environment("demo")`.
5. The service acquires a class-level lock for `demo`.
6. The service searches Docker for an existing managed container with label `mount-folder=demo`.
7. If a running container exists, it is returned with `reused: true`.
8. If a stopped container exists, it is started and returned with `reused: true`.
9. If no usable container exists, the service creates a new container.
10. The new container is labeled, attached to the shared Docker network, and bind-mounted to the workspace path.
11. The backend returns the environment metadata and public URL.
12. The frontend opens the returned editor URL.

### Important Details

Container name:

```text
vscode-env-<12hex>
```

Workspace mount:

```text
HOST_WORKSPACES_ROOT/<mount_folder> -> /home/workspace
```

Returned URL:

```text
http://vscode-env-<12hex>.localhost:8080?folder=%2Fhome%2Fworkspace
```

### Interview Follow-Up Questions

1. What happens if the same `mount_folder` already exists?
2. Why does create return `reused: true` sometimes?
3. What happens if Docker cannot start a stopped container?
4. Why is there a per-folder lock?
5. Does the lock work across multiple backend processes?

---

## 7. Idempotency And Concurrency

The create endpoint is designed to be idempotent by workspace folder.

If the user creates `demo` multiple times, the backend tries to reuse the existing environment instead of creating duplicates.

The current implementation also has a class-level lock registry:

```text
mount_folder -> threading.Lock
```

This means concurrent create requests for the same folder are serialized inside one backend process.

### What This Solves

It prevents this local race:

1. Request A checks for `demo`.
2. Request B checks for `demo`.
3. Both see nothing.
4. Both create a container.

With the lock, only one request can execute the create-or-reuse logic for `demo` at a time.

### Remaining Limitation

The lock is in memory. It works only inside one Python process.

If the backend is scaled to multiple uvicorn workers, multiple containers, or multiple hosts, the system needs:

- A distributed lock, or
- A persistent database uniqueness constraint, or
- A scheduler/orchestrator with a stronger resource model.

### Interview Follow-Up Questions

1. Is `POST /environments` truly idempotent?
2. What does the in-memory lock protect?
3. What does the in-memory lock not protect?
4. How would you solve this in a multi-replica backend?

---

## 8. Routing Architecture

nginx has two main routing responsibilities.

### 8.1 Management Plane Routing

Requests to:

```text
http://localhost:8080/api/...
```

are proxied to:

```text
http://backend:8000/...
```

The nginx config uses:

```nginx
location /api/ {
    proxy_pass http://backend:8000/;
}
```

The trailing slash is important because it strips the `/api/` prefix.

Example:

```text
/api/environments -> /environments
```

### 8.2 Editor Plane Routing

Requests to:

```text
http://vscode-env-abc123def456.localhost:8080
```

match:

```nginx
server_name "~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$";
```

nginx captures:

```text
vscode-env-abc123def456
```

and proxies to:

```nginx
proxy_pass http://$vscode_container:3000;
```

This works because all containers are on the same Docker network.

### 8.3 Docker DNS

The nginx config includes:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
```

`127.0.0.11` is Docker's embedded DNS server.

It lets nginx resolve containers that did not exist when nginx started.

### 8.4 WebSocket Routing

openvscode-server requires WebSocket support.

nginx forwards:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Without this, the editor may load but terminal and real-time features can fail.

### Interview Follow-Up Questions

1. Why use subdomains instead of ports?
2. What does the nginx regex capture?
3. Why does nginx need Docker DNS?
4. What happens if WebSocket upgrade headers are missing?
5. What breaks if the container naming format changes?

---

## 9. Data And State Model

The system does not use a database.

State comes from Docker:

- Container name.
- Container status.
- Container labels.
- Container mounts.
- Container network attachments.

Application ownership is represented through labels:

```text
managed-by=vscode-web-env-manager
env-id=<12hex>
mount-folder=<folder-name>
```

Workspace data is stored on the host filesystem:

```text
HOST_WORKSPACES_ROOT/<mount_folder>
```

The container can be removed while the workspace data remains.

### Benefits

- Fewer moving parts.
- Simple local development.
- Docker remains the source of runtime truth.
- Easy manual inspection using Docker commands.

### Tradeoffs

- No transactional uniqueness guarantees.
- Limited query capability.
- No historical audit trail.
- State is tied to one Docker host.
- Scaling beyond one host requires a new state model.

### Interview Follow-Up Questions

1. Why is there no database?
2. What is stored in Docker labels?
3. What happens to workspace data when a container is removed?
4. What state model would you use in production?

---

## 10. Security Architecture

### Current Security Controls

The project has several important local safety controls:

- The backend is not directly exposed as a host port in Compose.
- API traffic goes through nginx.
- `mount_folder` is validated with Pydantic.
- Resolved paths are checked to stay inside `HOST_WORKSPACES_ROOT`.
- Container operations are scoped by `managed-by` label.
- Editor containers are reached through nginx, not individual host ports.

### Major Security Risk

The backend mounts:

```text
/var/run/docker.sock
```

This gives the backend powerful control over the host Docker daemon. Anyone who can make the backend execute arbitrary Docker operations could effectively compromise the host.

For a local assignment, this is acceptable if clearly acknowledged.

For production, this must be hardened.

### Production Security Improvements

- Add authentication.
- Add authorization per user/environment.
- Add rate limiting.
- Add CPU/memory/pid limits.
- Use a Docker socket proxy with a restricted API surface.
- Run containers with non-root users where possible.
- Avoid arbitrary host path access.
- Add audit logs.
- Add TLS for non-localhost deployments.

### Interview Follow-Up Questions

1. Why is the Docker socket dangerous?
2. What prevents path traversal?
3. What does the `managed-by` label protect?
4. How would you add authentication?
5. What is the first security improvement you would make?

---

## 11. Scalability Architecture

The current architecture is single-host and local-first.

### What Scales Acceptably

- Multiple environment containers can run on the same Docker host.
- nginx can route many subdomains through one public port.
- No per-environment host port allocation is needed.
- The backend does not require a database for local operation.

### Current Scaling Limits

- All environments run on one Docker host.
- No resource limits are configured for editor containers.
- Docker SDK calls are synchronous.
- Image pulls happen during user-facing flows.
- In-memory locking does not work across processes or replicas.
- No idle cleanup/reaper exists.
- No central state store exists.

### Production Scaling Direction

For a larger system, the architecture would likely evolve toward:

- Kubernetes or Nomad for scheduling.
- Persistent database for environment metadata.
- Queue-based asynchronous provisioning.
- Pre-pulled images or custom golden images.
- Per-user resource quotas.
- Distributed locking or unique constraints.
- Metrics and tracing.
- Idle environment cleanup.

### Interview Follow-Up Questions

1. What breaks first if 50 users create environments?
2. How would you prevent one container from consuming the host?
3. How would you support multiple hosts?
4. Would you keep Docker Compose in production?

---

## 12. CI/CD Architecture

CI/CD is implemented with GitHub Actions:

```text
vscode-web-manager/.github/workflows/ci.yml
```

### Backend Checks

The backend job:

- Sets up Python 3.12.
- Installs runtime and dev dependencies.
- Runs `ruff`.
- Runs `pytest`.
- Builds the backend Docker image.
- Validates Docker Compose configuration.

### Frontend Checks

The frontend job:

- Sets up Node.js 20.
- Runs `npm ci`.
- Runs ESLint.
- Runs TypeScript typecheck.
- Builds the frontend.
- Builds the frontend/nginx Docker image with `frontend/Dockerfile` from the repo-root context.

### Publish Job

On push to `main`, after checks pass:

- Builds multi-architecture images.
- Publishes backend and frontend images to Docker Hub.
- Tags images as `latest` and `sha-<short>`.
- Uses Docker Buildx and QEMU.

### Interview Follow-Up Questions

1. What does CI validate?
2. What is the difference between CI and CD here?
3. Why publish only on `main`?
4. Why are immutable image tags better than `latest`?
5. What CI test is still missing?

---

## 13. Testing Architecture

The backend tests are fast and mostly hermetic.

Current backend test count:

```text
36 tests
```

### Test Layers

| Test Area | Purpose |
|---|---|
| Schema tests | Validate input rules for `mount_folder`. |
| Service tests | Test lifecycle logic with fake Docker objects. |
| Route tests | Test HTTP status mapping with fake services. |
| Health tests | Verify liveness endpoint. |
| Concurrency tests | Verify same-folder create requests do not double-provision in one process. |

### Strengths

- No Docker daemon is required for core test suite.
- Fake gateway makes failure states easy to simulate.
- Route tests verify FastAPI dependency override strategy.
- Path traversal behavior is tested.
- Concurrency fix is covered.

### Missing Tests

- Real Docker integration test.
- nginx routing test.
- Full Compose smoke test.
- Browser/e2e test.
- Frontend component tests.
- Test that opens a real openvscode environment.

### Interview Follow-Up Questions

1. Why use fake Docker objects?
2. What is the difference between unit and integration coverage here?
3. What would your first e2e test do?
4. Why is testing nginx routing important?

---

## 14. Main Architectural Tradeoffs

### Docker Labels Instead Of Database

Good for:

- Simplicity.
- Local development.
- Fast assignment scope.

Weak for:

- Auditing.
- Multi-host scaling.
- Complex queries.
- Strong uniqueness guarantees.

### Docker Socket Instead Of Orchestrator

Good for:

- Direct local Docker control.
- Simple setup.
- No Kubernetes dependency.

Weak for:

- Security.
- Production isolation.
- Multi-tenant safety.

### nginx Subdomains Instead Of Port Allocation

Good for:

- One public port.
- Clean URLs.
- No host port management.

Weak for:

- Coupling between container names and nginx regex.
- Requires wildcard/local subdomain behavior.
- Needs DNS/TLS planning outside localhost.

### In-Memory Lock Instead Of Persistent Coordination

Good for:

- Single-process correctness.
- Simple implementation.
- Fast local fix.

Weak for:

- Multiple workers.
- Multiple replicas.
- Multiple hosts.

### Interview Follow-Up Questions

1. Which tradeoff was most important?
2. Which tradeoff would you revisit first for production?
3. Why not use Kubernetes from the beginning?
4. Why not store state in SQLite/Postgres now?

---

## 15. Production Readiness Assessment

### Strong Areas

- Clear separation of concerns.
- Good local Docker architecture.
- nginx routing avoids per-container host ports.
- Input validation and path containment are thoughtful.
- Docker access is isolated behind a gateway.
- CI covers backend and frontend checks.
- Tests cover service behavior, route behavior, validation, and concurrency.

### Weak Areas

- No authentication.
- Docker socket is exposed to backend.
- No resource limits.
- No end-to-end Compose test.
- No frontend component/e2e tests.
- No structured logging/metrics.
- No idle cleanup.
- No distributed coordination.
- Domain config is localhost-specific in nginx.

### Interview Follow-Up Questions

1. What is the biggest production blocker?
2. What would you improve first with one more day?
3. How would you make this multi-user?
4. How would you monitor this in production?

---

## 16. Recommended Interview Explanation

Use this as your polished 2-minute architecture answer:

> This project is a single-host environment manager for browser-based VS Code workspaces. nginx is the only public entry point on port 8080. It serves the React dashboard, proxies `/api` calls to the FastAPI backend, and routes editor traffic by matching subdomains like `vscode-env-abc123def456.localhost`.
>
> The FastAPI backend is the control plane. It validates requests, resolves safe workspace paths under `HOST_WORKSPACES_ROOT`, and uses a Docker gateway wrapper around the Docker SDK to create or reuse `openvscode-server` containers. Each environment container is labeled with ownership metadata, attached to the same Docker network as nginx, and bind-mounted to a persistent host workspace folder.
>
> The main architectural choices are label-based ownership instead of a database, subdomain routing instead of per-container ports, and a layered backend with route, service, and Docker infrastructure boundaries. The project also includes same-folder concurrency protection with a per-folder in-memory lock, fast backend tests with fake Docker objects, frontend checks, Docker image builds, and a GitHub Actions publish pipeline.
>
> The biggest production gaps are authentication, Docker socket hardening, resource limits, full e2e testing, observability, and distributed coordination if the backend runs with multiple workers or replicas.

---

## 17. Interview Challenge Questions

### Architecture

1. Why did you choose this architecture instead of a monolithic backend serving everything?
2. What are the main responsibilities of nginx?
3. What does the backend own, and what does Docker own?
4. Why is the editor traffic not routed through FastAPI?

### Backend

1. Why did you split route, service, and Docker gateway layers?
2. What belongs in the service layer?
3. How does FastAPI validation help this project?
4. Why are response models not fully enforced yet, and would you add them?

### Docker

1. Why mount the Docker socket?
2. Why is mounting the Docker socket risky?
3. Why use bind mounts for workspaces?
4. What does `restart: unless-stopped` mean?

### nginx And Networking

1. How does nginx know which container to proxy to?
2. Why does Docker DNS matter?
3. Why are WebSocket upgrade headers required?
4. How would this change for a real domain and HTTPS?

### State And Concurrency

1. Why are Docker labels used as state?
2. How does idempotent create work?
3. What does the per-folder lock solve?
4. Why is the lock not enough for multi-process scaling?

### Security

1. What is the biggest security weakness?
2. How do you prevent host path traversal?
3. What would you add before exposing this publicly?
4. How would you isolate users from each other?

### Scalability

1. What happens when many users create environments?
2. How would you add resource limits?
3. How would you support multiple Docker hosts?
4. Would Kubernetes be a better long-term runtime?

### Testing And CI

1. What do the current tests prove?
2. What do they not prove?
3. Why use fake Docker gateways?
4. What e2e test would you add first?

---

## 18. Final Architecture Positioning

The architecture is strongest when described as:

> A clean single-host control plane for browser-based development containers, using FastAPI for lifecycle management, Docker for runtime isolation, nginx for dynamic subdomain routing, and React for operator/user experience.

The honest limitation is:

> It is a good local and assignment-grade architecture. Production readiness requires security hardening, resource governance, distributed state/locking, and end-to-end operational validation.
