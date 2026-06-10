# EXPLANATION — VS Code Web Environment Manager

> A walkthrough of every architectural decision, tech-stack choice, and code path in this project. Written so you can defend any line of code on a call.

---

## Table of contents

1. [What the system does (in one paragraph)](#1-what-the-system-does-in-one-paragraph)
2. [The big picture: three runtime pieces on one network](#2-the-big-picture-three-runtime-pieces-on-one-network)
3. [Tech stack — what and why](#3-tech-stack--what-and-why)
4. [The Docker Compose file, line by line](#4-the-docker-compose-file-line-by-line)
5. [The nginx config, line by line](#5-the-nginx-config-line-by-line)
6. [The frontend dashboard](#6-the-frontend-dashboard)
7. [The backend Dockerfile](#7-the-backend-dockerfile)
8. [The FastAPI app — bootstrap and layout](#8-the-fastapi-app--bootstrap-and-layout)
9. [The `core/config.py` settings singleton](#9-the-coreconfigpy-settings-singleton)
10. [The schema layer — Pydantic as the first defense](#10-the-schema-layer--pydantic-as-the-first-defense)
11. [The infra layer — `DockerGateway`](#11-the-infra-layer--dockergateway)
12. [The service layer — `EnvironmentService`](#12-the-service-layer--environmentservice)
13. [The route layer — thin handlers + dependency injection](#13-the-route-layer--thin-handlers--dependency-injection)
14. [Critical invariants (do not break these)](#14-critical-invariants-do-not-break-these)
15. [Testing strategy](#15-testing-strategy)
16. [The CI pipeline](#16-the-ci-pipeline)
17. [Security model and threat surface](#17-security-model-and-threat-surface)
18. [What I would do next if I had another day](#18-what-i-would-do-next-if-i-had-another-day)

---

## 1. What the system does (in one paragraph)

You `POST /api/environments {"mount_folder":"demo"}` and the backend launches a fresh `openvscode-server` container, names it `vscode-env-<12-hex>`, bind-mounts `workspaces/demo/` from your host into `/home/workspace` inside the container, and returns a URL like `http://vscode-env-abc123def456.localhost:8080?folder=/home/workspace`. You open that URL in a browser; nginx looks at the subdomain, captures the container name with a regex, and proxies your HTTP/WebSocket traffic to that specific container. Stop / start / remove are all label-scoped — the backend only ever touches containers it created itself. A small React dashboard (served by the same nginx) drives the management API and adds a "Start & open" flow that wakes up *exited* environments before opening them, so a tab opened against a dead container doesn't 502.

---

## 2. The big picture: three runtime pieces on one network

```
┌──────────────────────── host machine ──────────────────────────┐
│                                                                │
│  browser ──:8080──▶ ┌──────────┐                                │
│                     │  nginx   │                                │
│                     └────┬─────┘                                │
│           /api/   ┌──────┴──────┐   vscode-env-*.localhost      │
│                   │             │                                │
│                   ▼             ▼                                │
│              ┌─────────┐   ┌────────────────────┐               │
│              │ backend │   │ vscode-env-<hex>   │               │
│              │ FastAPI │   │  (openvscode)      │ → /home/      │
│              └────┬────┘   └────────────────────┘    workspace  │
│                   │  docker.sock                          │      │
│                   ▼                                       │      │
│              ┌─────────┐                                  │      │
│              │  Docker │                                  ▼      │
│              │  daemon │            HOST_WORKSPACES_ROOT (bind)  │
│              └─────────┘                                         │
│                                                                  │
│        all three containers share network manager-net            │
└──────────────────────────────────────────────────────────────────┘
```

Three containers, one Docker network (`manager-net`, name comes from `ENV_NETWORK`):

1. **`vscode-manager-nginx`** — public entry point on host port `8080`. Two virtual hosts (more on this in §5). The `localhost` host also serves the bundled **React SPA** from `/usr/share/nginx/html` as a static asset — the nginx image is built with `frontend/Dockerfile` from the repo-root context, so the running container ships nginx with the pre-built React dashboard and `deploy/nginx.conf` baked in.
2. **`vscode-manager-backend`** — FastAPI on port `8000` (internal only). Talks to the host's Docker daemon via the mounted `/var/run/docker.sock`. This is what makes "the backend can create new containers on the host" actually work.
3. **`vscode-env-<12-hex>`** — one container per environment. Image is `gitpod/openvscode-server`. Always labeled `managed-by=vscode-web-env-manager` so the backend can find them again.

**Why one network?** nginx needs to proxy to `http://vscode-env-abc123def456:3000` by name. Docker's embedded DNS resolves container names only on the network they share. If env containers landed on a different network, nginx would get `NXDOMAIN` and the subdomain magic would break.

---

## 3. Tech stack — what and why

| Layer | Choice | Why this and not the obvious alternative |
|---|---|---|
| HTTP framework | **FastAPI 0.115** | Pydantic v2 is built in (`mount_folder` regex validation is free), async-first, OpenAPI docs at `/docs` are free. The alternative — Flask + flask-pydantic + flask-restx — is three packages doing what FastAPI does in one. |
| ASGI server | **Uvicorn 0.30 (`[standard]`)** | The `[standard]` extra pulls in `httptools`/`uvloop` for speed and `websockets` (we don't terminate WS in the backend, but nginx upgrades pass-through so it's harmless). |
| Validation | **Pydantic v2.8** | Regex + length validation at the model boundary returns HTTP 422 automatically. No hand-rolled `if`/`raise`. |
| Settings | **pydantic-settings 2.4** | Loads `.env` into a typed `Settings` model. Beats `os.environ.get(...)` scattered through the codebase. |
| Docker client | **docker-py 7.1** | Official Python SDK. Talks the Docker Engine API over the Unix socket. |
| Image runtime | **Python 3.12-slim** | Slim image keeps the layer small; 3.12 is a current, supported runtime (matches `pyproject.toml`'s `target-version = "py312"`). |
| Tests | **pytest 8.3 + httpx 0.27** | `httpx` is what FastAPI's `TestClient` is built on. |
| Lint | **ruff 0.6** | One tool, fast, covers `E`, `F`, `I` (isort), `B` (bugbear). No separate isort/flake8/pyflakes. |
| Reverse proxy | **nginx 1.27-alpine** | Battle-tested. Native regex `server_name` capture is the cleanest way to map subdomain → upstream. |
| Environment image | **`gitpod/openvscode-server`** | The assignment specifies VS Code in the browser; this image is the reference openvscode-server distribution. |
| Frontend framework | **React 19 + TypeScript + Vite** | The dashboard is a single-page app, ≤30 components. Vite gives sub-second HMR during dev; React 19's stable concurrent rendering is fine for a polling dashboard. TS catches the shape of API responses end-to-end. |
| Server state | **TanStack Query 5** | Every list/detail view polls (`refetchInterval`). TanStack Query handles the cache, stale-while-revalidate, and per-mutation invalidation in one library — replaces the hand-rolled `useEffect`-and-`setTimeout` you'd otherwise write. |
| Toasts / styles | **Sonner + Tailwind 4** | Sonner is the smallest decent toast library; toasts are how mutations report success/failure. Tailwind 4 with the Vite plugin compiles utility classes at build time — no separate PostCSS config. |
| Frontend image | **`node:20-alpine` (build) → `nginx:1.27-alpine` (runtime)** | Multi-stage Dockerfile: build the React bundle in Node, copy `dist/` into the nginx image. Runtime container has no Node, no `node_modules`, only static assets. |

### A note on FastAPI over Flask

FastAPI gives us three things at the route level that matter here:

```python
@router.post("", status_code=status.HTTP_201_CREATED)
def create_environment(request: CreateEnvironmentRequest, service: ServiceDep) -> dict:
    ...
```

1. **`request: CreateEnvironmentRequest`** — body parsed and validated; 422 on failure, no boilerplate.
2. **`service: ServiceDep`** — `Annotated[EnvironmentService, Depends(get_environment_service)]`; injection happens automatically, and `app.dependency_overrides[...]` makes tests trivial.
3. **`status_code=status.HTTP_201_CREATED`** — declarative; the OpenAPI doc reflects it.

Flask would need a Pydantic adapter, a DI library, and a manual `return jsonify(...), 201`.

---

## 4. The Docker Compose file, line by line

```yaml
services:
  backend:
    build:
      context: ./backend
    container_name: vscode-manager-backend
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}
    environment:
      - PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
      - ENV_NETWORK=${ENV_NETWORK}
      - HOST_WORKSPACES_ROOT=${HOST_WORKSPACES_ROOT}
      - OPENVSCODE_IMAGE=${OPENVSCODE_IMAGE}
    networks:
      - manager-net

  nginx:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    container_name: vscode-manager-nginx
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      - backend
    networks:
      - manager-net

networks:
  manager-net:
    name: ${ENV_NETWORK:-vscode-manager-net}
```

### `build: context: ./backend`

Compose builds from the local Dockerfile. No registry push needed for local dev. CI also runs `docker build -t vscode-manager-backend ./backend` as a smoke test (catches Dockerfile regressions before they hit `docker compose up`).

### `nginx: build: context: .`

The nginx service is **built**, not pulled. Compose uses the repo root as the build context and `./frontend/Dockerfile` as the Dockerfile:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
```

Stage 1 (`node:20-alpine`) installs deps and runs `vite build`. Stage 2 (`nginx:1.27-alpine`) starts from a fresh nginx and **only copies `/app/dist`** plus `deploy/nginx.conf` in — no Node, no `node_modules`, no source files in the runtime image. The resulting container is small and ships nginx plus the React SPA pre-built. The reverse-proxy config (§5) is baked into the image, so Docker Hub images are self-contained and Compose does not need a config bind mount.

### `restart: unless-stopped` (not `always`)

This is a **deliberate** choice — not a default. The difference:

- `always` → Docker daemon restarts the container even if you manually stopped it.
- `unless-stopped` → Docker daemon restarts it on crashes / host reboots, but **respects an operator `docker stop`**.

We have a `POST /environments/{id}/stop` endpoint. If env containers used `always`, the next daemon reconciliation would resurrect a stopped container, silently breaking the API's contract. Same logic applies to backend and nginx — operators must be able to take the system down.

### `/var/run/docker.sock:/var/run/docker.sock`

This is what gives the backend "create containers on the host" power. The Docker daemon listens on this Unix socket. By mounting it into the container, the docker-py client inside the backend talks to the **host's** daemon, not a daemon inside its own container. The containers it creates are host-level, sibling containers — not children.

**Security implication.** Anyone with access to this socket effectively has root on the host. That is why:

- The backend is not exposed publicly (no `ports:` block); only nginx is.
- nginx only proxies `/api/` and `/health` from `localhost` to the backend. There's no path from a browser to the docker.sock except through endpoints we control.
- Every container we create is label-tagged so we can never accidentally touch one we didn't make (more in §11).

### `${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}` — the passthrough mount

The two sides are intentionally identical. Why?

The backend constructs a path like `Path(settings.host_workspaces_root) / mount_folder` and passes it to `docker.containers.run(volumes={...})`. That volume dict is interpreted by the **Docker daemon**, which runs on the host. So the keys in `volumes={...}` must be **host paths**, even though they're computed inside the backend container.

By mounting the host path 1:1 inside the backend, the Python code can:

1. **`mkdir`** the workspace dir using `Path(...)` — works because the path exists at the same location inside the container.
2. **Pass that same path string** to docker-py — works because the daemon sees the same path on the host.

If we had used a different inside path (e.g. `/workspaces`), we'd need a translation step every time we cross the docker.sock boundary. Identity is simpler.

This is also why `.env.example` says `HOST_WORKSPACES_ROOT=/absolute/path/...` — a relative path would resolve to two different absolute paths on the two sides of the mount.

### `networks: manager-net` and the `${ENV_NETWORK:-vscode-manager-net}` default

The `:-` is a shell-style default. If `.env` doesn't set `ENV_NETWORK`, the network is named `vscode-manager-net`. The same default lives in `core/config.py`'s `Settings`, so the backend and Compose always agree on the network name unless someone changes one and not the other.

The backend attaches new env containers to `settings.env_network`. If Compose put nginx and backend on a different network than env containers, nginx couldn't resolve `vscode-env-<hex>` over Docker DNS — so `ENV_NETWORK` must match `manager-net.name`.

### `depends_on: backend`

Compose starts the backend before nginx. Without this, nginx could come up first and fail health checks against the not-yet-listening backend.

---

## 5. The nginx config, line by line

```nginx
events {}

http {
    resolver 127.0.0.11 valid=10s ipv6=off;

    server {
        listen 80;
        server_name localhost;

        location /health {
            proxy_pass http://backend:8000/health;
        }

        location /api/ {
            proxy_pass http://backend:8000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location / {
            root /usr/share/nginx/html;
            index index.html;
            try_files $uri $uri/ /index.html;
        }
    }

    server {
        listen 80;
        server_name "~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$";

        location / {
            proxy_pass http://$vscode_container:3000;

            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

            proxy_read_timeout 3600;
            proxy_send_timeout 3600;
        }
    }
}
```

### `resolver 127.0.0.11 valid=10s ipv6=off;`

`127.0.0.11` is Docker's **embedded DNS server**, available inside every user-defined network. It resolves container names to IPs.

You **must** declare a `resolver` for nginx to do DNS lookups at runtime — without it, nginx resolves upstream hostnames only once at config-load time and caches forever. Since env containers are created and destroyed at runtime (their IPs don't exist when nginx starts), we need runtime DNS.

- `valid=10s` — re-resolve every 10 seconds (low so a removed/recreated container is picked up fast).
- `ipv6=off` — Docker's embedded DNS returns NXDOMAIN for AAAA queries; turning off IPv6 lookups avoids slow timeouts.

### Virtual host #1: `server_name localhost`

This serves the management plane.

```nginx
location /api/ {
    proxy_pass http://backend:8000/;
    ...
}
```

The **trailing slash on both sides** is load-bearing. With both `/api/` and `http://backend:8000/`, nginx strips the prefix: a request to `/api/environments` is forwarded as `/environments`. The backend routes are registered without an `/api/` prefix, so this rewrite is what makes the routes match.

`proxy_set_header Host $host;` is needed because `urlsplit(settings.public_base_url).hostname` is later used to build env URLs. We don't actually consume `Host` for that, but it's good hygiene for any downstream code.

#### The `location /` SPA fallback

```nginx
location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;
}
```

This is what makes the React dashboard work. `try_files` checks for the requested URI as a file, then as a directory, then **falls back to `/index.html`**. The fallback matters because the SPA owns client-side routing — if a user reloads `localhost:8080/some/deep/route`, there's no such file on disk; without this fallback nginx would 404, and instead we want it to deliver the SPA shell, which then renders the route in JS.

Ordering: nginx matches `location /api/` and `location /health` first (longer prefix wins), so `/api/...` and `/health` keep going to the backend. Everything else (`/`, `/assets/...`, deep routes) falls into the SPA block. The two concerns coexist on one virtual host.

### Virtual host #2: the regex subdomain

```nginx
server_name "~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$";
```

This is the magic. Breaking it down:

- `~` — tells nginx the value is a regex (PCRE).
- `^...$` — anchored full-match.
- `(?<vscode_container>...)` — **named capture group**. nginx binds the captured string to the variable `$vscode_container`, which we use in `proxy_pass`.
- `vscode-env-[a-f0-9]{12}` — matches **exactly** the container names the backend produces (`uuid.uuid4().hex[:12]` → lowercase hex, 12 chars).

```nginx
proxy_pass http://$vscode_container:3000;
```

The captured variable is fed directly into the upstream. nginx asks Docker's DNS to resolve `vscode-env-abc123def456`, gets the container IP on `manager-net`, and proxies. Port `3000` is openvscode-server's default HTTP port.

**Why a regex instead of a wildcard `*.localhost`?**

1. A wildcard would also match `evil.localhost` or `malformed.localhost`, and we'd then have to validate inside the proxy block. The regex restricts the surface to exactly our naming scheme at the nginx layer.
2. We need the captured name as a variable for `proxy_pass`. Wildcards don't give you that.

**WebSocket upgrade headers:**

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

openvscode-server uses WebSockets for the editor's terminal, language servers, and file watcher. nginx must forward the `Upgrade: websocket` and `Connection: upgrade` headers, otherwise the client and server can't switch protocols. `proxy_http_version 1.1` is required (HTTP/1.0 has no `Upgrade` semantics).

`proxy_read_timeout 3600; proxy_send_timeout 3600;` — one hour. Idle SSH/terminal connections need long timeouts; the nginx default of 60s would kill them.

---

## 6. The frontend dashboard

The frontend is a React single-page app under `frontend/`. It is not a second server in production. It is built into static files by Vite, copied into the nginx image, and served from `/usr/share/nginx/html` by the same nginx process that already proxies `/api/*` and `vscode-env-*.localhost`.

The important mental model:

```
frontend source code
  └─ npm run build
       └─ dist/index.html + assets/*.js + assets/*.css
            └─ copied into nginx image
                 └─ served at http://localhost:8080/
```

So the browser sees one origin:

```
http://localhost:8080
  ├── /          -> React SPA
  ├── /api/*     -> FastAPI backend, through nginx
  └── vscode-env-*.localhost:8080 -> openvscode containers, through nginx
```

That "one origin" matters. The React app can call `fetch("/api/environments")` instead of `fetch("http://localhost:8000/environments")`, which means no CORS policy, no exposed backend port, and the same URL shape in dev/prod conversations.

### Frontend file layout

```
frontend/src/
├── main.tsx                    # React root, QueryClient, Sonner toaster
├── App.tsx                     # renders Dashboard
├── pages/Dashboard.tsx         # top-level UI state and user flows
├── hooks/api.ts                # TanStack Query hooks and mutations
├── lib/api.ts                  # fetch wrapper, API methods, ApiError
├── lib/types.ts                # frontend copies of API response shapes
├── lib/utils.ts                # class merging, status labels
└── components/
    ├── HeaderBar.tsx
    ├── HealthPill.tsx
    ├── EnvironmentManifest.tsx
    ├── ManifestRow.tsx
    ├── CreateEnvironmentDialog.tsx
    ├── EnvironmentDetailSheet.tsx
    ├── ConfirmDialog.tsx
    └── ui/                     # local Button/Dialog/Sheet/StatusDot primitives
```

The app is intentionally shallow. `App.tsx` only returns `<Dashboard />`; most orchestration lives in `Dashboard.tsx`, and API behavior is centralized in `hooks/api.ts` + `lib/api.ts`.

### `main.tsx`: providers and defaults

`main.tsx` creates a TanStack Query client and renders the app:

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1_000,
      refetchOnWindowFocus: false,
    },
  },
})
```

`staleTime: 1_000` prevents immediate refetch churn while keeping the dashboard fresh. `refetchOnWindowFocus: false` is deliberate because the list already polls; focus-triggered refetches would add noise without improving the UX much. The `Toaster` is global so every mutation can report success/failure from the hook layer.

### `lib/api.ts`: the API boundary

The frontend talks to the backend through one small client:

```ts
const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, ...)
  ...
}
```

Every call is relative to `/api`, so nginx handles the environment-specific host/port details. The client also normalizes backend errors:

- normal 2xx JSON -> typed response
- `204 No Content` -> `undefined`
- FastAPI/Pydantic error bodies with `detail` -> readable `ApiError.message`
- non-JSON error bodies -> fallback to text/status

The exported API methods map directly to backend routes:

```ts
api.listEnvironments()          // GET    /api/environments
api.getEnvironment(id)          // GET    /api/environments/{id}
api.createEnvironment(input)    // POST   /api/environments
api.stopEnvironment(id)         // POST   /api/environments/{id}/stop
api.stopAllEnvironments()       // POST   /api/environments/stop-all
api.removeEnvironment(id)       // DELETE /api/environments/{id}
api.dockerInfo()                // GET    /api/docker/info
```

### `hooks/api.ts`: server state and mutations

TanStack Query owns server state:

- `useDockerInfo()` polls every 10 seconds for the header health pill.
- `useEnvironments()` polls every 3 seconds for the manifest.
- `useEnvironmentDetail(id)` polls every 5 seconds while the detail sheet is open.
- mutations invalidate the relevant query keys after success.

That avoids the usual trap of hand-written `useEffect`, `setInterval`, local loading flags, and stale lists after mutations. The hooks also own toast behavior, so the UI components can stay focused on interaction.

The `createEnvironment` mutation treats `reused` as meaningful:

```ts
if (data.reused) {
  toast.success('Environment reused', ...)
} else {
  toast.success('Environment created', ...)
}
```

That maps to the backend idempotency design: the same endpoint can either provision a brand-new container or reuse/start an existing one with the same `mount_folder`.

### `Dashboard.tsx`: the user flows

`Dashboard` owns only UI state:

```ts
const [createOpen, setCreateOpen] = useState(false)
const [detailId, setDetailId] = useState<string | null>(null)
const [confirm, setConfirm] = useState<ConfirmIntent | null>(null)
```

The main flows are:

1. **Create environment** — open `CreateEnvironmentDialog`, submit `mount_folder`, call `POST /api/environments`, close dialog, open the detail sheet for the returned id.
2. **Stop environment** — confirm, call `POST /api/environments/{id}/stop`, invalidate list/detail.
3. **Remove environment** — confirm, call `DELETE /api/environments/{id}`, preserve the workspace folder on disk.
4. **Stop all** — confirm, call `POST /api/environments/stop-all`, report stopped/skipped/failed counts.
5. **Start & open** — for an exited container, call `POST /api/environments` again with the same `mount_folder`; the backend reuse path starts it and waits for openvscode readiness, then the frontend opens `result.url` in a new tab.

The "Start & open" flow is the reason the backend has a readiness wait. Without it, the frontend could open the subdomain while Docker reports the container as `running` but openvscode has not bound port `3000` yet. nginx would return a transient 502, and the user would have to refresh.

Keyboard shortcuts are small but useful:

- `N` opens the provision dialog.
- `R` invalidates the environments and Docker-info queries.
- shortcuts are ignored while the user is typing in an input/textarea/contenteditable element.

### `CreateEnvironmentDialog`: client-side validation mirrors the backend

The create dialog uses `react-hook-form` with Zod:

```ts
const schema = z.object({
  mount_folder: z
    .string()
    .min(1, 'Required')
    .max(80, '80 character maximum')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, numbers, hyphen, underscore only'),
})
```

This mirrors the backend Pydantic regex. It is UX validation, not security. The backend remains the source of truth and still returns 422 if the request is invalid. The frontend validation just catches the common case before a network round trip.

### `EnvironmentManifest` and `EnvironmentDetailSheet`

`EnvironmentManifest` renders the list returned by `GET /api/environments`. It shows loading/error/empty states, keeps a small "sync" indicator when polling is active, and delegates row actions to `Dashboard` so confirmation dialogs are centralized.

`EnvironmentDetailSheet` calls `GET /api/environments/{id}` and shows the inspect-style details the backend exposes: labels, mounts, image, status, and Docker networks. This is useful in an interview because it proves the dashboard is not just a create button; it surfaces the same trust-boundary details the backend depends on.

### Vite dev mode

In local frontend dev, Vite runs on port `5173`:

```ts
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ''),
    },
  },
}
```

This mirrors production's nginx rewrite:

```
/api/environments -> /environments
```

The catch is that the backend is not exposed by Compose in the normal full-stack setup. For Vite dev mode, you either run the backend natively on `localhost:8000`, or you temporarily publish backend port `8000`. For Docker-first frontend iteration, rebuilding only the nginx service is often simpler:

```bash
docker compose up -d --build nginx
```

### Frontend production packaging

The `frontend/Dockerfile` is a multi-stage build:

```dockerfile
FROM node:20-alpine AS builder
...
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
```

Node exists only in the build stage. The runtime image is nginx with static assets. This keeps the shipped image smaller, avoids a production Node process, and lets one nginx process serve both the dashboard and the reverse-proxy routes.

The source of truth for routing is `deploy/nginx.conf`, baked into the frontend/nginx image:

```yaml
nginx:
  build:
    context: .
    dockerfile: frontend/Dockerfile
```

Changing either React code or nginx routing requires rebuilding the frontend/nginx image. That is intentional for this assignment because the image is self-contained for the zero-build reviewer flow.

### What the frontend does not own

The dashboard is intentionally not a security boundary. It improves UX, but every important invariant remains backend-owned:

- allowed `mount_folder` shape
- workspace path containment
- managed-container label filtering
- Docker socket access
- environment network attachment
- readiness wait before returning a started reused container

That is the right split: the frontend is allowed to be helpful and optimistic, but the backend must remain correct when called directly with `curl`.

---

## 7. The backend Dockerfile

```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Small but every line earns its place.

- **`python:3.12-slim`** — `slim` is ~50 MB vs ~1 GB for the full image. We don't compile native extensions (docker-py is pure Python), so `slim` is enough.
- **`PYTHONDONTWRITEBYTECODE=1`** — skip `.pyc` files inside the image (a few MB saved, cleaner layer).
- **`PYTHONUNBUFFERED=1`** — stdout/stderr are unbuffered so `docker logs` shows uvicorn output in real time.
- **`PIP_NO_CACHE_DIR=1`** — pip would otherwise keep wheels in `~/.cache/pip`; the image is smaller without them.
- **`COPY requirements.txt` before `COPY app`** — classic Docker layer-cache trick. As long as requirements don't change, edits to `app/` reuse the cached pip install layer.
- **`tests` not copied** — see `.dockerignore`. The runtime image carries only `app/` and the deps.
- **`uvicorn ... --host 0.0.0.0`** — must bind to `0.0.0.0` (not `127.0.0.1`), otherwise it would only listen on localhost inside the container and nginx couldn't reach it across the bridge network.

---

## 8. The FastAPI app — bootstrap and layout

```python
# backend/app/main.py
from fastapi import FastAPI

from app.api.routes.docker import router as docker_router
from app.api.routes.environments import router as environments_router
from app.api.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="VS Code Environment Manager")

    app.include_router(health_router)
    app.include_router(docker_router)
    app.include_router(environments_router)

    return app

app = create_app()
```

A tiny factory + a module-level `app` instance. Two reasons it's a factory:

1. Tests that need a clean app can call `create_app()` to get a fresh `FastAPI` instance with no leaked `dependency_overrides`.
2. The `app = create_app()` line at the bottom is what uvicorn looks up via the entry point string `"app.main:app"`.

The backend is organized **bottom-up** under `app/`:

```
app/
├── main.py                        # bootstrap
├── core/config.py                 # Settings singleton
├── schemas/environment.py         # Pydantic request/response models
├── infra/docker_gateway.py        # the only file that imports `docker`
├── services/environment_service.py# all lifecycle logic
└── api/routes/
    ├── health.py
    ├── docker.py                  # GET /docker/info
    └── environments.py            # CRUD + stop-all
```

Each layer depends only on the layer below it. The route layer imports the service; the service imports the gateway; the gateway is the only file that imports `docker`. This is what makes the `FakeDockerGateway` testing strategy work without any monkeypatching of `docker.from_env()`.

---

## 9. The `core/config.py` settings singleton

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    public_base_url: str = "http://localhost:8080"
    env_network: str = "vscode-manager-net"
    host_workspaces_root: str = "/tmp/vscode-workspaces"
    openvscode_image: str = "gitpod/openvscode-server"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
```

- **Defaults are real defaults**, not placeholders. The service ships with sane values for everything; `.env` only overrides them.
- `env_file=".env"` — pydantic-settings loads `.env` from the working directory at process start. In Compose, that's `/app` (set by `WORKDIR /app`), but Compose also passes the four env vars explicitly via the `environment:` block, which takes precedence — so the backend works whether or not a `.env` is bind-mounted into the container.
- `extra="ignore"` — extra keys in `.env` (e.g. someone adds `DEBUG=true` for their own tooling) are silently ignored instead of raising. Loose-coupled to your local env.
- `settings = Settings()` at module level — read once at import time, used everywhere as `from app.core.config import settings`. Tests use `monkeypatch.setattr(settings, ..., ...)` to swap values for a single test (see `conftest.py`).

### Subtlety: why `monkeypatch` instead of re-instantiating `Settings`?

Because `services.environment_service` already imported `settings` at module-load time. Replacing the global symbol would not affect the binding inside the service. `monkeypatch.setattr(settings, "host_workspaces_root", str(tmp_path))` mutates the **same object** the service is using, so the override takes effect.

---

## 10. The schema layer — Pydantic as the first defense

```python
# backend/app/schemas/environment.py
from pydantic import BaseModel, Field


class CreateEnvironmentRequest(BaseModel):
    mount_folder : str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[a-zA-Z0-9_-]+$",
        examples=["demo-project"],
    )

class EnvironmentResponse(BaseModel):
    id: str
    container_name: str
    status: str
    url: str
    workspace_path: str
```

This is the **first** line of defense against path-traversal. The regex `^[a-zA-Z0-9_-]+$` rejects:

- `/etc/passwd` (slash)
- `../etc` (dot)
- `..\\windows` (backslash, dot)
- `mount folder` (space)
- empty string (covered by `min_length=1`)

The 80-char cap blocks pathological inputs (Linux filenames are 255 max; 80 is plenty for an env name).

If the request body fails the schema, FastAPI returns **422 Unprocessable Entity** automatically — no `try/except` in the route. The route is only called with valid data.

`tests/test_schemas.py` locks the regex contract:

```python
@pytest.mark.parametrize("mount_folder",
    ["../etc", "../../root", "/home/user", "folder/name", "folder name", ""])
def test_create_environment_request_rejects_invalid_mount_folder(mount_folder):
    with pytest.raises(ValidationError):
        CreateEnvironmentRequest(mount_folder=mount_folder)
```

If someone "improves" the regex in the future, these tests fail and force them to think about it.

---

## 11. The infra layer — `DockerGateway`

```python
# backend/app/infra/docker_gateway.py
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
```

### Why a gateway at all?

`docker-py`'s `client.containers.run(...)` returns a `Container` model that is conceptually fine to pass around, but **`docker.from_env()` opens a Unix socket connection**. If services did this themselves, every test of the service would either need to patch `docker.from_env` or hit a real daemon. By concentrating the import in one file, we can pass a `FakeDockerGateway` into `EnvironmentService` and never touch the SDK from tests. See §15.

### `docker.from_env()` vs `docker.DockerClient(base_url=...)`

`docker.from_env()` reads `DOCKER_HOST`, `DOCKER_TLS_VERIFY`, etc. from the process environment and chooses the right transport. Inside our container, `DOCKER_HOST` is unset, so docker-py falls back to the **mounted Unix socket at `/var/run/docker.sock`**. This is exactly what we want.

### `ensure_image_exists` before `run_container`

```python
def ensure_image_exists(self, image: str) -> None:
    try:
        self.client.images.get(image)
    except ImageNotFound:
        self.client.images.pull(image)
```

`containers.run(image=...)` will pull automatically if the image is missing — but it pulls every time without a local check, and the first call is slow with no feedback. Doing an explicit `get` first means the second + N-th env creation never pulls.

### `list_managed_containers` and the label filter

```python
return self.client.containers.list(
    all=True,
    filters={"label": "managed-by=vscode-web-env-manager"},
)
```

`all=True` includes stopped containers (default is running-only). The `label` filter is **applied by the Docker daemon**, not in Python — efficient even when the host has hundreds of unrelated containers. This is the cornerstone of the trust boundary: a list operation **cannot** return an unmanaged container. From the backend's perspective, containers without our label do not exist.

### `remove_container(force=True)`

`force=True` is `docker rm -f` — kills + removes in one call. Without it, you'd need to stop first, then remove. The endpoint is `DELETE /environments/{id}`; users expect it to work whether the container is running or not.

### `@lru_cache(maxsize=1) get_docker_gateway()`

This is the FastAPI dependency. `lru_cache(maxsize=1)` is the simplest valid singleton in Python:

- First call: instantiate `DockerGateway()` (opens the Docker connection), cache the instance.
- Every call after: return the same instance.

This is the same pattern the FastAPI docs recommend for "expensive-to-build, safe-to-share" dependencies (settings, DB engines, HTTP clients). The Docker client is thread-safe for our usage (sync, short-lived calls).

If we returned a new `DockerGateway` per request, every request would open a new socket connection.

---

## 12. The service layer — `EnvironmentService`

This is where the business logic lives. We'll go through it section by section.

### Class skeleton and the `MANAGED_BY_LABEL` constant

```python
MANAGED_BY_LABEL = "vscode-web-env-manager"

READINESS_TIMEOUT_SECONDS = 10.0
READINESS_POLL_INTERVAL_SECONDS = 0.25


class EnvironmentNotFoundError(Exception):
    pass


class EnvironmentService:
    def __init__(
        self,
        docker_gateway: DockerGateway,
        *,
        wait_for_ready: Callable[[str], None] | None = None,
    ) -> None:
        self.docker = docker_gateway
        self._wait_for_ready = wait_for_ready or _wait_for_openvscode_ready
```

`MANAGED_BY_LABEL` is a module-level constant because the gateway also references the same string (in `list_managed_containers`). The label is the **trust boundary** — see §14.

The constructor takes an **optional** `wait_for_ready` callable. In production, it defaults to `_wait_for_openvscode_ready` (HTTP polling against the env container's `:3000`). In tests, the fixture injects a no-op so the suite stays fast and DNS-free. See §12's "Readiness wait" subsection and §15's testing strategy.

`EnvironmentNotFoundError` is a **domain exception** raised by the service when an env id isn't found. The route layer maps it to HTTP 404. Two reasons not to raise `HTTPException` directly:

1. Services should not know about HTTP. If you reused the service in a CLI tool, an `HTTPException` would be nonsense.
2. The route layer's `except EnvironmentNotFoundError → 404` is explicit and testable.

### `create_environment` — the most interesting method

```python
def create_environment(self, mount_folder: str) -> dict:
    existing_container = self._find_existing_environment_by_mount_folder(mount_folder)

    if existing_container is not None:
        reused_environment = self._try_reuse_existing_environment(existing_container)

        if reused_environment is not None:
            return reused_environment

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
                "mode": "rw",
            }
        },
    )

    container.reload()

    return {
        "id": env_id,
        "container_name": container.name,
        "status": container.status,
        "url": self._build_environment_url(container.name),
        "workspace_path": str(workspace_path),
        "reused": False,
    }
```

Three concerns happening here:

#### A. Idempotency by `mount-folder` label

A client that retries (network blip, refresh, page reload) calling `POST /environments {"mount_folder":"demo"}` should not end up with three containers all bind-mounting the same workspace. So we first look for an existing container with the same `mount-folder` label and try to reuse it. See `_try_reuse_existing_environment`:

```python
def _try_reuse_existing_environment(self, container: Container) -> dict | None:
    container.reload()
    just_started = False

    if container.status != "running":
        try:
            self.docker.start_container(container)
            container.reload()
            just_started = True
        except Exception:
            self.docker.remove_container(container)
            return None

    if just_started:
        self._wait_for_ready(container.name)

    labels = container.labels
    mount_folder = labels.get("mount-folder", "unknown")
    workspace_path = self._resolve_workspace_path(mount_folder)

    return {
        "id": labels.get("env-id", "unknown"),
        "container_name": container.name,
        "status": container.status,
        "url": self._build_environment_url(container.name),
        "workspace_path": str(workspace_path),
        "reused": True,
    }
```

The state machine:

- **Running** → return it as-is, `reused=True`. No wait — the container has been up for a while, openvscode is long since listening.
- **Exited** → call `start()`, **then `self._wait_for_ready(container.name)`** to block until openvscode binds `:3000`, return it, `reused=True`.
- **Start fails** (image deleted under us, volume gone, kernel limits) → remove the broken container and return `None` from the helper, which makes the caller fall through to "provision fresh". This is the self-healing branch — a poisoned environment can't permanently break a `mount_folder` name.

#### The readiness wait (`_wait_for_openvscode_ready`)

```python
def _wait_for_openvscode_ready(container_name: str) -> None:
    deadline = time.monotonic() + READINESS_TIMEOUT_SECONDS
    probe_url = f"http://{container_name}:3000/"
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(probe_url, timeout=1.0).close()
            return
        except urllib.error.HTTPError:
            return  # any HTTP response means the server is listening
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
            pass
        time.sleep(READINESS_POLL_INTERVAL_SECONDS)
```

Why this exists: Docker reports a container as `running` the instant the init process starts — but `openvscode-server` is a Node app and takes another ~1-2s after that to bind port `3000`. If `POST /environments` returned during that gap and the **frontend's "Start & open" flow** immediately opened the env URL, nginx would resolve the container, hit `:3000`, get connection-refused, and reply 502. Users would see a 502 page that disappeared on refresh — a confusing failure with no real root cause to fix at the nginx or browser layer.

The wait closes that race **on the backend side, on the manager Docker network**, where the backend can talk to the env container by name. The probe treats any HTTP response (200, 404, even 5xx from openvscode itself) as "the server is up". Only connection-refused / DNS failure / timeout keep the poll loop going. Total budget: 10 seconds, 250 ms between polls.

The wait is `Callable[[str], None]`, injected via the constructor:

- **Production**: `_wait_for_openvscode_ready` (above) — real HTTP polling.
- **Tests**: `wait_for_ready=lambda _: None` — no-op. Without injection, tests against the `FakeDockerGateway` would call `urllib.request.urlopen("http://fake-container:3000/")`, fail DNS resolution on the host, loop for 10 seconds, and slow the suite to a crawl.

Only the **just-started** branch calls it. Already-running reuses and fresh creates skip the wait — the former because openvscode is already listening, the latter because the dashboard doesn't auto-open the URL on fresh creates (it shows the manifest, where the user clicks at human speed, by which time openvscode is ready).

#### B. ID generation: `uuid.uuid4().hex[:12]`

12 lowercase-hex chars = 48 bits of entropy ≈ collision probability `~ n² / 2 * 2^48`. For our scale (tens of env containers ever), the chance of a collision is essentially zero. We pick 12 chars instead of the full 32 because:

1. The nginx regex hard-codes `[a-f0-9]{12}`. The two must agree exactly.
2. 12 chars keeps the subdomain reasonable: `vscode-env-abc123def456.localhost`.
3. The hostname becomes a usable browser URL (under 63 chars per label, the DNS limit).

#### C. Path safety: `_resolve_workspace_path`

```python
def _resolve_workspace_path(self, mount_folder: str) -> Path:
    root = Path(settings.host_workspaces_root).resolve()
    target = (root / mount_folder).resolve()

    if target != root and root not in target.parents:
        raise ValueError("mount_folder must stay inside the configured workspaces root")

    return target
```

Defense in depth. Even though the Pydantic regex blocks slashes and dots, **this function must independently verify** that the resolved path doesn't escape `HOST_WORKSPACES_ROOT`. Two reasons:

1. If someone later loosens the regex (`"oh, dots are fine for ext-style names"`), the resolve-and-check is still the second wall.
2. `_resolve_workspace_path` is also called from `_try_reuse_existing_environment`, where the `mount_folder` comes from a **container label** — not validated by the schema. A previously-broken-or-tampered label can't take down the backend.

The check works because `Path.resolve()` normalizes `..` and resolves symlinks. After resolution, the path must equal `root` or have `root` as an ancestor. If neither, we're outside the sandbox.

Tested explicitly:

```python
@pytest.mark.parametrize("mount_folder", ["..", "../etc", "subdir/../..", "/etc"])
def test_resolve_workspace_path_rejects_traversal(service, mount_folder):
    with pytest.raises(ValueError, match="must stay inside"):
        service._resolve_workspace_path(mount_folder)
```

#### D. The `volumes` dict for docker-py

```python
volumes={
    str(workspace_path): {
        "bind": "/home/workspace",
        "mode": "rw",
    }
}
```

The format is `{host_path: {"bind": container_path, "mode": "rw" | "ro"}}`. `host_path` must be the path **as the daemon sees it** (i.e. on the host). That's why §4's passthrough mount matters: `str(workspace_path)` works on both sides.

The container path is `/home/workspace` — hard-coded because openvscode-server's `?folder=` query param needs an absolute path to open on boot, and we want to know what to put there.

### `list_environments`

```python
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
                "mount_folder": labels.get("mount-folder", "unknown"),
            }
        )

    return environments
```

Straight loop. `container.reload()` re-fetches state from the daemon (`status`, `labels`) — `list()` returns lightweight summaries. `labels.get(..., "unknown")` handles the edge where a container was created by an older version that didn't set the label.

### `get_environment` — uses inspection

```python
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
```

`attrs` is the full output of `docker inspect <container>`. We expose the four fields a client/operator typically wants: which image, what labels, what's bind-mounted where, what network it's on.

### `stop_environment` and `stop_all_environments`

`stop_environment` is straightforward (look up by env_id, stop). `stop_all_environments` is more interesting:

```python
def stop_all_environments(self) -> dict:
    stopped_environments = []
    failed_environments = []

    for container in self.docker.list_managed_containers():
        container.reload()
        labels = container.labels
        env_id = labels.get("env-id", "unknown")

        if container.status != "running":
            stopped_environments.append({
                "id": env_id,
                "container_name": container.name,
                "previous_status": container.status,
                "status": container.status,
                "skipped": True,
            })
            continue

        try:
            self.docker.stop_container(container)
            container.reload()

            stopped_environments.append({
                "id": env_id,
                "container_name": container.name,
                "previous_status": "running",
                "status": container.status,
                "skipped": False,
            })
        except Exception as exc:
            failed_environments.append({
                "id": env_id,
                "container_name": container.name,
                "error": str(exc),
            })

    return {
        "stopped_count": len([e for e in stopped_environments if not e["skipped"]]),
        "skipped_count": len([e for e in stopped_environments if e["skipped"]]),
        "failed_count": len(failed_environments),
        "environments": stopped_environments,
        "failures": failed_environments,
    }
```

Three categories: **stopped** (actually stopped them), **skipped** (already stopped — not a failure, but worth surfacing), **failed** (raised during `stop`). A batch operation should not let one bad container abort the rest, so we catch per-container and report at the end.

This is the only place `except Exception` is used inside the service. It's a deliberate trade: a single broken container should not cause a "stop all my environments" call to half-succeed silently. The exception is recorded by container, not swallowed.

### `remove_environment`

```python
def remove_environment(self, env_id: str) -> dict:
    container = self._get_environment_container(env_id)
    self.docker.remove_container(container)

    return {"id": env_id, "removed": True}
```

`remove_container` uses `force=True` (see §11), so this works whether the container is running or stopped.

### `_build_environment_url`

```python
def _build_environment_url(self, container_name: str) -> str:
    parsed_url = urlsplit(settings.public_base_url)

    if parsed_url.hostname is None:
        raise ValueError("PUBLIC_BASE_URL must include a valid hostname")

    host = f"{container_name}.{parsed_url.hostname}"

    if parsed_url.port is not None:
        host = f"{host}:{parsed_url.port}"

    query = urlencode({"folder": "/home/workspace"})

    return urlunsplit((parsed_url.scheme, host, "", query, ""))
```

For `PUBLIC_BASE_URL=http://localhost:8080` and `container_name=vscode-env-abc123def456`:

1. `urlsplit` → `scheme=http`, `hostname=localhost`, `port=8080`.
2. `host = "vscode-env-abc123def456.localhost"`, then with port: `"vscode-env-abc123def456.localhost:8080"`.
3. `urlencode({"folder": "/home/workspace"})` → `folder=%2Fhome%2Fworkspace` (URL-safe).
4. `urlunsplit` → `http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace`.

The `?folder=` query param tells openvscode-server to open `/home/workspace` on load (so the user lands inside their bind-mounted folder). The path is hard-coded to `/home/workspace` because the bind mount is hard-coded to `/home/workspace`.

Tested in `test_build_environment_url_with_port` and `test_build_environment_url_without_port` (for the case where `PUBLIC_BASE_URL=https://demo.example.com` — no port should be appended).

---

## 13. The route layer — thin handlers + dependency injection

```python
# backend/app/api/routes/environments.py
from typing import Annotated

from docker.errors import APIError, DockerException
from fastapi import APIRouter, Depends, HTTPException, status

from app.infra.docker_gateway import DockerGateway, get_docker_gateway
from app.schemas.environment import CreateEnvironmentRequest
from app.services.environment_service import EnvironmentNotFoundError, EnvironmentService

router = APIRouter(prefix="/environments", tags=["environments"])


def get_environment_service(
    docker_gateway: Annotated[DockerGateway, Depends(get_docker_gateway)],
) -> EnvironmentService:
    return EnvironmentService(docker_gateway)


ServiceDep = Annotated[EnvironmentService, Depends(get_environment_service)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_environment(request: CreateEnvironmentRequest, service: ServiceDep) -> dict:
    try:
        return service.create_environment(request.mount_folder)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except APIError as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except DockerException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
```

### The `Annotated[X, Depends(...)]` form

Pre-FastAPI 0.95, the recommended form was:

```python
def create_environment(
    request: CreateEnvironmentRequest,
    service: EnvironmentService = Depends(get_environment_service),
): ...
```

This is the **B008** ruff warning: function defaults shouldn't be calls (mutable-default footgun, surprising semantics in inheritance). The `Annotated` form moves `Depends(...)` into the type annotation, leaving the parameter without a default:

```python
ServiceDep = Annotated[EnvironmentService, Depends(get_environment_service)]

def create_environment(request: CreateEnvironmentRequest, service: ServiceDep): ...
```

Pulling `ServiceDep` out as a type alias is a stylistic choice — every route uses it, so naming it once keeps the routes readable.

### The exception ladder in `create_environment`

```python
except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
except APIError as exc:
    if exc.status_code == 409:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    raise HTTPException(status_code=502, detail=str(exc)) from exc
except DockerException as exc:
    raise HTTPException(status_code=502, detail=str(exc)) from exc
```

- **`ValueError`** — `_resolve_workspace_path` raises this on traversal attempts. The schema **should** have caught it at the boundary; if it slipped through, that's a client error → **400**.
- **`docker.errors.APIError`** with `status_code==409` — Docker reported a name collision (very rare; uuid4 12-hex chars + the reuse-by-label path makes a name conflict effectively a transient race). Pass it through as **409**.
- **`APIError`** (other) — a Docker API error that isn't a 409. The daemon is reachable but something went wrong (out of disk, image pull failed). **502 Bad Gateway** — the gateway (Docker) returned an error.
- **`DockerException`** — base class. Daemon unreachable, socket gone. **502**.

Bare `Exception` is never caught — anything else propagates and FastAPI logs a real 500 with a stack trace, which is exactly what you want during debugging.

`from exc` preserves the cause chain (Python's `raise X from Y`), so the original `APIError` is the `__cause__` of the `HTTPException` and appears in the log output.

### `raise HTTPException(status_code=404)` for not-found

```python
@router.get("/{env_id}")
def get_environment(env_id: str, service: ServiceDep) -> dict:
    try:
        return service.get_environment(env_id)
    except EnvironmentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
```

Same pattern as 400/502: catch the domain exception in the route, map to HTTP.

### `/docker/info` — a probe

```python
@router.get("/info")
def docker_info(
    gateway: Annotated[DockerGateway, Depends(get_docker_gateway)],
) -> dict:
    try:
        info = gateway.docker_info()
    except DockerException as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "docker": "connected",
        "server_version": info.get("ServerVersion"),
        "containers": info.get("Containers"),
        "images": info.get("Images"),
    }
```

This is a connectivity test. Returns 200 with the daemon's version + counts if reachable; 502 otherwise. Useful for "is the socket actually mounted?" debugging without creating side effects.

### `/health`

```python
@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

Liveness only. Does **not** touch Docker — that's `/docker/info`'s job. nginx forwards `/health` to backend `/health` directly (no path rewriting) because container orchestrators read this endpoint frequently and any Docker call here would couple liveness to daemon availability.

---

## 14. Critical invariants (do not break these)

These are the constraints that hold the system together. If you change one, you must change the others.

1. **Container name format ↔ nginx regex.** `vscode-env-<12 lowercase hex>` ↔ `^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$`. Touch one, touch both.
2. **Bind path inside the env container is `/home/workspace`.** Used as the volume `bind:` target *and* in the `?folder=...` URL query. Both must agree.
3. **The `managed-by=vscode-web-env-manager` label is the trust boundary.** Never list, start, stop, or remove a container without filtering by this label first.
4. **`HOST_WORKSPACES_ROOT` must be absolute and mounted 1:1.** Backend writes to it as a Python path; Docker daemon reads it as a host path; they must be the same.
5. **`unless-stopped` everywhere, not `always`.** `always` would make `POST /stop` a lie.
6. **`_resolve_workspace_path` must remain defense in depth.** Even if the Pydantic regex is relaxed, the resolve-and-check must remain. Don't remove either.
7. **`docker.from_env()` only lives in `infra/docker_gateway.py`.** Services and routes must never import `docker` directly — that's what makes the `FakeDockerGateway` test strategy work.
8. **`ENV_NETWORK` (Compose) == `settings.env_network` (backend).** Both must name the same Docker network for nginx ↔ backend ↔ env-containers DNS to work.
9. **The readiness wait must run when (and only when) we just started an exited container.** The frontend's "Start & open" flow assumes that when `POST /environments` returns for a previously-exited container, openvscode-server is reachable — opening the URL the moment the call resolves should succeed on the first try. If the wait is removed (or skipped), the UX regresses to a 502 page that disappears on refresh. If it runs on the running-reuse or fresh-create paths, the endpoint slows down without buying anything.

---

## 15. Testing strategy

Three test files, ~34 tests total, no real Docker daemon needed.

### `tests/test_schemas.py` — Pydantic contract

Pin the regex. If someone "fixes" `^[a-zA-Z0-9_-]+$` to be more permissive, these fail.

### `tests/test_environment_service.py` — service logic with a fake gateway

`FakeDockerGateway` is a hand-rolled in-memory implementation of `DockerGateway`. Key knobs on `FakeContainer`:

```python
class FakeContainer:
    def __init__(self, *, name, labels, status="created",
                 image="test/openvscode:latest", network="test-net",
                 raise_on_start=False, raise_on_stop=False):
        ...
```

`raise_on_start=True` and `raise_on_stop=True` are what let us cover the **replace-broken-on-reuse** path and the **stop-all-with-failure** path without needing a poisoned Docker container.

Example — the broken-reuse replace test:

```python
def test_create_replaces_broken_container_when_start_fails(service, gateway):
    gateway.add(FakeContainer(
        name="vscode-env-broken000001",
        labels={
            "managed-by": MANAGED_BY_LABEL,
            "env-id": "broken000001",
            "mount-folder": "demo",
        },
        status="exited",
        raise_on_start=True,
    ))

    result = service.create_environment("demo")

    assert "vscode-env-broken000001" in gateway.removed_names
    assert len(gateway.run_container_calls) == 1
    assert result["reused"] is False
```

We seed an exited container that will throw on `.start()`, call `create_environment`, and assert that the broken one was removed and a fresh one was provisioned.

The `gateway.run_container_calls` list also lets us assert the exact arguments passed to `run_container` — labels, image, network, volumes — in `test_create_environment_passes_correct_labels_and_volumes`.

### `tests/test_environments_routes.py` — HTTP status-code mapping

We don't even use the real service here. We override the dependency:

```python
app.dependency_overrides[get_environment_service] = lambda: FakeEnvironmentService()
```

Then the `FakeEnvironmentService` lets us set `create_raises = ValueError(...)`, `get_raises = EnvironmentNotFoundError(...)`, etc. The test asserts on the status code:

```python
def test_post_environments_returns_400_on_value_error(client, fake_service):
    fake_service.create_raises = ValueError("mount_folder must stay inside ...")
    response = client.post("/environments", json={"mount_folder": "demo"})
    assert response.status_code == 400
```

This is the cleanest way to test the route's exception → HTTP mapping, without coupling the test to service internals.

### `conftest.py` — the settings monkeypatch

```python
@pytest.fixture
def test_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "host_workspaces_root", str(tmp_path))
    monkeypatch.setattr(settings, "openvscode_image", "test/openvscode:latest")
    monkeypatch.setattr(settings, "env_network", "test-net")
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:8080")
    return settings
```

`tmp_path` is a pytest fixture that gives you a unique scratch directory per test. By pointing `host_workspaces_root` at it, every `service.create_environment("demo")` makes `tmp_path/demo/` and the test cleans up automatically.

### The `service` fixture — no-op readiness waiter

```python
@pytest.fixture
def service(gateway: FakeDockerGateway, test_settings) -> EnvironmentService:
    return EnvironmentService(gateway, wait_for_ready=lambda _: None)
```

The `wait_for_ready=lambda _: None` injection is what keeps the service test suite fast. The production default (`_wait_for_openvscode_ready`) does HTTP polling against `http://<container_name>:3000/`. In tests, that hostname has no DNS record on the host — `urllib` would raise `URLError(gaierror)` each iteration, the loop would sleep and retry for the full 10-second budget, and every reuse-path test would take 10 seconds. With the no-op, the wait collapses to a single call that returns immediately. The branch is still exercised — `just_started` still flips, the wait is still invoked — only the side effect (HTTP probe) is mocked away.

---

## 16. The CI pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
  pull_request:

jobs:
  backend-checks:
    runs-on: ubuntu-latest

    env:
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install backend dependencies
        working-directory: backend
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r requirements.txt
          python -m pip install -r requirements-dev.txt

      - name: Lint backend
        working-directory: backend
        run: python -m ruff check .

      - name: Run backend tests
        working-directory: backend
        run: python -m pytest

      - name: Build backend Docker image
        run: docker build -t vscode-manager-backend ./backend

      - name: Validate Docker Compose config
        env:
          PUBLIC_BASE_URL: http://localhost:8080
          ENV_NETWORK: vscode-manager-net
          HOST_WORKSPACES_ROOT: /tmp/vscode-workspaces
          OPENVSCODE_IMAGE: gitpod/openvscode-server
        run: docker compose config
```

### Triggers

`on: push` + `on: pull_request` — fires on direct pushes and on PR open/update. Two events means a fork PR runs CI before merging.

### `runs-on: ubuntu-latest`

GitHub-hosted Ubuntu runner. Pre-installs Python, Docker, and Compose so we don't have to.

### `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`

A pragmatic shim. GitHub transitioned action runtimes to Node 24; some actions hadn't updated their `node20` declaration when this was written. The env var forces them to run under Node 24 regardless, sidestepping warnings/failures during the migration window. Safe to remove once all actions declare `node24`.

### `actions/checkout@v4` and `actions/setup-python@v5`

Pinned to major versions. Both `@v4` and `@v5` receive non-breaking updates within the major — secure-enough for this scope. For production-critical pipelines you'd pin to a commit SHA.

### Check jobs

`backend-checks`:

1. **Install deps** — runtime + dev (pytest, httpx, ruff).
2. **`ruff check`** — same command we run locally; if it fails locally it fails in CI and vice versa.
3. **`pytest`** — no Docker needed (the FakeDockerGateway strategy pays off here).
4. **`docker build ./backend`** — proves the backend Dockerfile still works.
5. **`docker compose config`** — validates `docker-compose.yml`. The `env:` block on this step provides placeholder values so variable interpolation succeeds. `compose config` parses + resolves the file and prints the merged config, returning non-zero on syntax or schema errors. It does **not** start anything.

`frontend-checks`:

1. **`npm ci`** — installs exactly from `frontend/package-lock.json`.
2. **`npm run lint`** — catches ESLint regressions.
3. **`npm run typecheck`** — runs `tsc -b --noEmit`.
4. **`npm run build`** — runs the production Vite build.
5. **`docker build -f frontend/Dockerfile .`** — proves the frontend/nginx image works with the repo-root build context and can copy `deploy/nginx.conf`.

`publish-images` runs only on pushes to `main`, after both check jobs pass. It uses Docker Buildx and QEMU to publish `linux/amd64` and `linux/arm64` images to Docker Hub, tagged as `latest` and `sha-<short>`.

### What CI does **not** do

- No end-to-end test that actually `compose up`s and hits the API. Doable with Docker-in-Docker on the runner, but the Compose validate + the fake-driven unit tests cover the contract surface without that complexity.
- No runtime smoke test against the published Docker Hub images. The pipeline proves the images build and push, but it does not pull them back and exercise the reviewer quickstart.

---

## 17. Security model and threat surface

Worth saying out loud what the protections are and what's still open.

### Mitigated

| Threat | Mitigation |
|---|---|
| Path traversal via `mount_folder` | Pydantic regex (`^[a-zA-Z0-9_-]+$`, 1–80 chars) + `_resolve_workspace_path` "must stay inside root" check |
| Accidentally managing unrelated containers | All operations filter by `label=managed-by=vscode-web-env-manager` |
| Docker name collisions | Reuse-by-`mount-folder`-label first; 12-hex random id reduces collision risk further |
| Stop endpoint silently undone | `restart: unless-stopped` instead of `always` |
| Long-running WebSocket dropped | nginx `proxy_read_timeout 3600` |

### Open / accepted

- **No authentication.** Anyone who can reach `localhost:8080` can create and access env containers. Acceptable for a single-developer local tool, which is the scope of the assignment. A real deployment would put an auth layer at nginx.
- **Docker socket = root.** The backend can do anything the Docker daemon can — that's the architecture of "spin up containers on demand." The mitigation is the label-scoped operations: even if an attacker compromised the backend process, the API surface only exposes `containers.run`/`stop`/`remove` on labeled containers.
- **No resource quotas.** A user can create unlimited envs, each pulling `gitpod/openvscode-server`. A real deployment would add `cpu_count` / `mem_limit` to `run_container` and a max-env-count gate in the service.

---

## 18. What I would do next if I had another day

In rough priority order:

1. **Per-env auth** — generate a one-time token at create time, embed it in the URL, validate it at nginx via `auth_request`. Without this, anyone on the network can pop the URL.
2. **Resource limits** — `cpu_count`, `mem_limit`, and possibly `pids_limit` on the env containers via `run_container` kwargs.
3. **Structured logging** — `structlog` with JSON output, request IDs propagated from nginx (`X-Request-Id`). Right now it's uvicorn's default.
4. **`/metrics` endpoint** — Prometheus client + a counter for created/stopped/reused envs. Then a Grafana board.
5. **Background reaper** — a Periodic task that stops env containers idle for >N hours. Right now stale envs hang around forever.
6. **TLS** — use Caddy in place of nginx for automatic Let's Encrypt, or stick with nginx and add Certbot if we go to a real domain.
7. **An end-to-end smoke test in CI** — Docker-in-Docker, `compose up -d`, hit `POST /environments`, GET `/environments/{id}`, DELETE.
8. **Frontend in CI** — a `frontend-checks` job parallel to `backend-checks`: `setup-node@v4` → `npm ci` → `eslint` → `tsc --noEmit` → `npm run build`. Today TypeScript errors only surface at `docker compose up --build` time. Lowest-effort addition with the biggest signal improvement.
9. **Async readiness probe** — the `_wait_for_openvscode_ready` call inside `EnvironmentService` is a sync `urllib` poll loop, which holds a uvicorn worker for up to 10 seconds per "Start & open" call. With `httpx.AsyncClient` and an `async def` route, that wait stops blocking other requests. Not urgent at single-user scale; pre-requisite for the "50 concurrent users" target in QA.md Q43.
