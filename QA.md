# Q&A — Interview Prep for VS Code Web Environment Manager

> 50 questions across **Easy → Medium → Hard → Expert**. Every answer is grounded in the actual code of this repo. Use it as a rehearsal script — read the question, answer aloud, then check.

Topics: Python/FastAPI · Docker · Docker Compose · nginx · GitHub Actions · Pydantic · Security · Architecture · openvscode-server.

---

## EASY (1–12) — surface-level: what does it do?

### Q1. In one paragraph, what does this service do?

It exposes a small HTTP API for launching disposable, browser-accessible VS Code environments, plus a React dashboard on top of it. A `POST /api/environments {"mount_folder":"demo"}` makes the backend create a new `openvscode-server` container, bind-mount a host folder into it, and return a URL like `http://vscode-env-abc123def456.localhost:8080?folder=/home/workspace`. nginx fronts everything on host port `8080` — it serves the React SPA, proxies `/api/*` to the FastAPI backend, and captures the per-env container name from the subdomain via a regex `server_name` to proxy HTTP + WebSocket traffic to the right container. The backend can list / get / stop / stop-all / delete its environments, and it only ever touches containers it created itself (label-scoped). The dashboard adds one piece of UX worth calling out: when a user clicks the URL of an *exited* environment, it intercepts the click, calls the reuse path to start the container, **waits until openvscode-server is actually listening**, and only then opens the editor tab.

### Q2. What language and framework does the backend use, and why?

**Python 3.12 + FastAPI 0.115.** FastAPI bundles Pydantic v2 validation (so `mount_folder` regex enforcement is free with automatic 422 on failure), generates OpenAPI docs at `/docs`, and has a clean dependency injection model via `Annotated[X, Depends(...)]`. The same thing in Flask would need three extra packages.

### Q3. What is OpenVSCode Server and why use it instead of "real" VS Code?

`gitpod/openvscode-server` is the open-source distribution of VS Code's web editor: the same Monaco editor, command palette, extensions, and terminal, but running headlessly on port `3000` and accessed through a browser. It's what we need for "VS Code in the browser" because Microsoft's official VS Code app doesn't ship a server-mode binary you can run anywhere.

### Q4. How does the public URL `vscode-env-<id>.localhost` resolve at all?

`*.localhost` is reserved by RFC 6761 and on macOS/Linux is treated as a loopback alias by default — any subdomain of `localhost` resolves to `127.0.0.1` without DNS configuration. So `vscode-env-abc123def456.localhost` hits the local machine, where nginx is listening on `:8080`.

### Q5. What does `POST /environments` return?

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
`reused` is `true` if the call hit an existing container with the same `mount_folder` label. The dashboard uses this flag to pick toast copy ("Environment reused" vs "Environment created") — the same endpoint is the create path and the "start a stopped env" path, so the flag is what tells the client which one just happened.

### Q6. Where are the routes defined and how are they organized?

Three routers under `backend/app/api/routes/`:

- `health.py` → `GET /health`
- `docker.py` → `GET /docker/info`
- `environments.py` → `POST/GET/DELETE /environments[/...]`

All three are included by `create_app()` in `main.py`.

### Q7. How do you run the project locally?

Three ways depending on what you're iterating on:

```bash
# Full stack — nginx + backend + per-env subdomain resolution + the React SPA
cp .env.example .env  # edit HOST_WORKSPACES_ROOT to an absolute path
docker compose up --build

# Backend only (no nginx, no per-env subdomain resolution, no SPA)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Frontend only — Vite dev server with HMR, proxying /api to localhost:8000
cd frontend
npm install
npm run dev
```

For frontend iteration, the standard cycle is: `docker compose up -d --build nginx` — Vite's `npm run dev` needs the backend port published on the host (it's not, by default), so the rebuild-and-restart-nginx path is the cleanest dev loop. The rebuild takes ~10-20s and the backend keeps running.

### Q8. How do you run tests?

```bash
cd backend
python -m pytest                     # all 34 tests
python -m pytest tests/test_schemas.py
python -m pytest -k mount_folder     # by keyword
```

### Q9. What does CI run on every push/PR?

`.github/workflows/ci.yml` runs three jobs. `backend-checks` installs Python deps, runs `ruff`, runs `pytest`, builds the backend image, and validates `docker compose config`. `frontend-checks` installs npm deps, runs ESLint, runs TypeScript typecheck, runs the Vite build, and builds the frontend/nginx image with `frontend/Dockerfile` from the repo-root context. `publish-images` runs only on pushes to `main` after both check jobs pass; it publishes multi-arch backend and frontend images to Docker Hub.

### Q10. What environment variables does the backend need?

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Base URL exposed to clients; hostname is used to build per-env subdomains |
| `ENV_NETWORK` | Docker network name (must match the one used by nginx and env containers) |
| `HOST_WORKSPACES_ROOT` | **Absolute** host path where per-env workspaces live |
| `OPENVSCODE_IMAGE` | Image used for env containers (default `gitpod/openvscode-server`) |

### Q11. What format is the environment container name?

`vscode-env-<12 lowercase-hex>`, e.g. `vscode-env-abc123def456`. The 12 hex chars come from `uuid.uuid4().hex[:12]`.

### Q12. What's the public entry point and the internal backend port?

nginx is on host port **8080** (mapped from container port 80). Backend uvicorn is on port **8000**, accessible only from inside the Docker network. Per-env openvscode-server containers listen on **3000** internally, never exposed to the host — reachable only via nginx's subdomain-regex virtual host. The same nginx process also serves the built React SPA out of `/usr/share/nginx/html` (baked into its image at build time), so a single host port covers the dashboard, the management API, and every per-env editor.

---

## MEDIUM (13–28) — design choices and how pieces fit

### Q13. Walk me through what happens, end-to-end, when a user hits `POST /api/environments {"mount_folder":"demo"}`.

1. **Browser → nginx (`:8080`)** → matches `server_name localhost`, hits `location /api/`.
2. **nginx → backend** → strips `/api/` (trailing slashes on both sides), proxies `POST /environments` to `http://backend:8000/environments`.
3. **FastAPI** parses the JSON body into a `CreateEnvironmentRequest` — Pydantic validates `mount_folder` against `^[a-zA-Z0-9_-]+$`. Fails → 422 (no service call).
4. **Route handler** resolves the service via `get_environment_service` → `EnvironmentService(DockerGateway())`.
5. **`create_environment("demo")`** first calls `_find_existing_environment_by_mount_folder("demo")`. If a container with `mount-folder=demo` exists and is running → return it (`reused=True`). If it's exited → `start`; if start fails → `remove`. Otherwise fall through.
6. Generate `env_id = uuid.uuid4().hex[:12]`. Compute `workspace_path = HOST_WORKSPACES_ROOT/demo` and `mkdir` it.
7. Call `gateway.run_container(image=..., name="vscode-env-<id>", network=ENV_NETWORK, labels={managed-by, env-id, mount-folder}, volumes={workspace_path: {bind:/home/workspace, mode:rw}})`.
8. Reload the container to get `status`, build the URL, return 201.
9. **Browser opens the URL** → nginx matches `~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.localhost$`, proxies to `http://$vscode_container:3000`. Docker DNS resolves the container name on `manager-net`.

### Q14. Why is the bind path inside the env container hard-coded to `/home/workspace`?

It must be agreed on by two things: the `volumes={host_path: {bind: "/home/workspace", ...}}` argument we pass to docker-py, and the `?folder=/home/workspace` query string we build into the env URL so openvscode-server opens that directory on load. Hard-coding the value in one place (`environment_service.py`) and reusing it for the URL keeps them consistent.

### Q15. Why mount `HOST_WORKSPACES_ROOT` 1:1 (same path inside and outside the backend container)?

Because the backend tells the **Docker daemon** to bind-mount that path into a new container, and the daemon runs on the host — it interprets every path as a host path. By mounting `${HOST_WORKSPACES_ROOT}:${HOST_WORKSPACES_ROOT}`, the path string the backend computes is valid both inside the backend container (for `mkdir`) and on the host (for the daemon's bind mount). No path-translation step, no surprises.

### Q16. Why must `HOST_WORKSPACES_ROOT` be absolute?

If it were relative (`./workspaces`), it would resolve to two different absolute paths on the two sides of the 1:1 mount — `./workspaces` relative to the host's current directory vs `./workspaces` relative to `/app` inside the container. The bind mount would silently mismatch.

### Q17. Why a regex `server_name` in nginx instead of a wildcard `*.localhost`?

Two reasons. (1) The regex restricts the surface to exactly our container-name format (`vscode-env-` + 12 hex). Wildcards would also match `evil.localhost` and force us to validate inside the proxy block. (2) The named capture group `(?<vscode_container>...)` exposes the captured string as `$vscode_container`, which we feed directly into `proxy_pass http://$vscode_container:3000`. Wildcards don't give you a variable.

### Q18. What does `resolver 127.0.0.11 valid=10s ipv6=off;` do and why is it required?

`127.0.0.11` is Docker's embedded DNS server inside every user-defined network — it resolves container names to IPs. nginx caches upstream resolutions at config-load time **unless** there's a `resolver` directive. Since our env containers are created and destroyed at runtime, nginx needs to re-resolve at request time. `valid=10s` re-checks every 10 seconds. `ipv6=off` skips AAAA lookups which Docker DNS returns NXDOMAIN for (avoids slow timeouts).

### Q19. Why `restart: unless-stopped` and not `always`?

`always` resurrects a container after a manual `docker stop`. We expose `POST /environments/{id}/stop`; if env containers used `always`, the next daemon reconciliation would silently revive them, turning that endpoint into a lie. `unless-stopped` still restarts on crash and host reboot, but respects an operator stop. Same choice applies to backend and nginx — operators must be able to take the system down.

### Q20. What's the `managed-by` label for?

It's the **trust boundary**. Every container we create gets `managed-by=vscode-web-env-manager`. Every list/stop/remove operation filters by that label on the Docker daemon side. The backend literally cannot see — let alone modify — containers it didn't create. If the daemon has 200 other containers running, our service treats the host as if only ours exist.

### Q21. Why does `create_environment` look for an existing container with the same `mount-folder` label first?

For idempotency. A retried `POST /environments {"mount_folder":"demo"}` should not pile up three identical containers all bind-mounting the same workspace. The state machine: running → return as-is; exited → `start`; start fails → remove + provision fresh. The response has a `reused: bool` so clients can tell.

### Q22. Walk me through `_resolve_workspace_path` and why it's still needed even with the Pydantic regex.

```python
def _resolve_workspace_path(self, mount_folder: str) -> Path:
    root = Path(settings.host_workspaces_root).resolve()
    target = (root / mount_folder).resolve()

    if target != root and root not in target.parents:
        raise ValueError("mount_folder must stay inside the configured workspaces root")
    return target
```

It joins the root with the `mount_folder`, calls `.resolve()` to normalize `..` and symlinks, and asserts the result is `root` or a descendant. Defense in depth — even if the schema regex is loosened later, this stops a traversal. It's also called from `_try_reuse_existing_environment` where `mount_folder` comes from a **container label**, which Pydantic never validated.

### Q23. What's the difference between `EnvironmentNotFoundError` and `HTTPException`, and why do we have both?

`EnvironmentNotFoundError` is a **domain exception** raised by the service. The service doesn't know about HTTP — if you reused it in a CLI, raising `HTTPException(404)` would be nonsense. The route layer catches `EnvironmentNotFoundError` and maps it to `HTTPException(404)`. This keeps the service framework-agnostic.

### Q24. Why is `get_docker_gateway()` wrapped in `@lru_cache(maxsize=1)`?

To make the gateway a process-wide singleton. `DockerGateway.__init__` calls `docker.from_env()`, which opens a Unix socket connection. Without caching, every request would open a new connection. `lru_cache(maxsize=1)` is the simplest Python pattern for "build once, return forever."

### Q25. How does the route layer inject the service, and how do tests override it?

The injection uses FastAPI's `Annotated` form:

```python
ServiceDep = Annotated[EnvironmentService, Depends(get_environment_service)]

def create_environment(request: CreateEnvironmentRequest, service: ServiceDep): ...
```

Tests override via `app.dependency_overrides`:

```python
app.dependency_overrides[get_environment_service] = lambda: FakeEnvironmentService()
```

Now `TestClient(app)` calls `create_environment` with the fake, and we can assert HTTP-level behavior without touching the real service.

### Q26. Why two test classes — `FakeDockerGateway` and `FakeEnvironmentService`?

Different layers of the dependency stack:

- `FakeDockerGateway` is for **service tests** — exercises `EnvironmentService` logic (reuse, stop-all, traversal). The fake has knobs like `raise_on_start=True` so we can hit the broken-container-replace branch.
- `FakeEnvironmentService` is for **route tests** — exercises FastAPI status code mapping (201, 400, 404, 422) and ignores service internals entirely.

Two fakes because each test layer needs only its own boundary stubbed.

### Q27. Why `Annotated[X, Depends(...)]` instead of `X = Depends(...)`?

The `X = Depends(...)` form is a parameter default that's a function call — ruff's `B008` rule flags this because mutable-default calls can surprise across inheritance and module reload. The `Annotated` form puts the marker in the type annotation, leaving the parameter declaration default-free. FastAPI's modern docs recommend it as of 0.95+.

### Q28. What does `docker compose config` do in CI, and why isn't `compose up` enough?

`docker compose config` parses, validates, and resolves the merged Compose configuration (variable substitution included), prints it, and exits non-zero on syntax/schema errors. It catches a typo in `docker-compose.yml` before someone tries to deploy. We don't run `compose up` in CI because (a) it would require pulling images and waiting for healthchecks, slow and flaky; (b) we'd then need a real end-to-end test on top of it. The unit-test layer + fake-driven route tests already cover the contract surface.

---

## HARD (29–42) — deep dives that separate "I built it" from "I designed it"

### Q29. Defend the choice to take `mount_folder` as a *name* instead of an arbitrary host path. The assignment example showed `?mount_folder=/home/usr`.

Accepting an arbitrary host path on an unauthenticated HTTP endpoint turns a query parameter into a remote read/write primitive against the host filesystem — combined with the docker.sock mount, that's RCE. The compromise is a **name** that's resolved to a subfolder of `HOST_WORKSPACES_ROOT`, with two walls: (1) Pydantic regex `^[a-zA-Z0-9_-]+$` rejects slashes/dots/spaces at the boundary; (2) `_resolve_workspace_path` requires the resolved path to be inside the configured root. The PDF said the API shape was open, so I took the defensible one. If the assignment had required arbitrary paths, I would have demanded auth and a server-side allowlist.

### Q30. Trace exactly what happens when nginx forwards the WebSocket connection that opens the integrated terminal.

1. Browser sends `GET /?folder=/home/workspace` to `vscode-env-abc123def456.localhost:8080`. openvscode-server replies with HTML/JS.
2. JS opens a `WebSocket` to the same host, path like `/static/.../socket?...`. The HTTP request includes `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key: ...`.
3. nginx matches the regex `server_name`, captures `vscode_container=vscode-env-abc123def456`.
4. Our config has `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` — required because `Upgrade` is only defined in HTTP/1.1 and the default upstream is HTTP/1.0.
5. nginx asks Docker's DNS at `127.0.0.11` to resolve `vscode-env-abc123def456` → returns the container's IP on `manager-net`.
6. nginx opens a TCP socket to that IP:3000, forwards the upgrade. openvscode-server responds `101 Switching Protocols`.
7. From there it's a full-duplex byte stream. `proxy_read_timeout 3600` keeps it alive for an hour of idle.

### Q31. Walk through every exception that can come out of `service.create_environment` and how the route layer maps each to a status code.

| Exception | Source | Mapped to | Reasoning |
|---|---|---|---|
| `ValidationError` (caught by FastAPI before the route) | Schema | `422` | Body failed `^[a-zA-Z0-9_-]+$` or length |
| `ValueError("must stay inside ...")` | `_resolve_workspace_path` defense-in-depth | `400` | Path traversal slipped past the schema |
| `docker.errors.APIError` with `status_code==409` | Name collision in daemon | `409` | Rare race; client can retry |
| `docker.errors.APIError` other | Daemon-side error (image pull failed, out of disk) | `502` | Upstream gateway returned error |
| `docker.errors.DockerException` | Daemon unreachable, socket gone | `502` | Upstream gateway down |
| anything else | Bug | `500` (propagated, FastAPI logs the traceback) | We want the stack, not a flattened message |

Bare `except Exception` is **not** in the route because it would hide bugs. The one place we do catch `Exception` is `stop_all_environments` — a batch op shouldn't abort on one failure.

One thing **not** in this ladder: the readiness wait that runs after starting a stopped container in `_try_reuse_existing_environment`. If openvscode-server doesn't bind `:3000` within the 10-second budget, the wait returns silently — no exception, no special status code. The endpoint still returns 201 with `reused=True`. The reasoning: the container *is* running (Docker confirmed it), and Docker's view of "started" is what the `status` field reflects. Raising would convert a "merely slow" startup into a hard client error and force the dashboard to retry — worse UX. The cost of the silent path is that the user *might* hit a 502 on first open in the rare case where openvscode takes >10s, which a refresh fixes.

### Q32. The `_container_name(env_id)` returns `f"vscode-env-{env_id}"` and the nginx regex is `vscode-env-[a-f0-9]{12}`. What happens if I change one without the other?

Two failure modes:

- **Change the Python name** (e.g. `vscode_env_<id>`): the new container name no longer matches the regex `server_name`. Browsers hitting the URL get the **default `localhost` vhost**, which doesn't have a `location /` block — they'd see 404 from nginx for everything except `/health` and `/api/`. The container is up and running, you just can't reach it.
- **Change the regex** (e.g. `[a-f0-9]{16}`): existing containers (12-hex) no longer match. New requests to those URLs hit the default vhost. Until you also bump `env_id = uuid.uuid4().hex[:12]` to 16, no new containers will be reachable either.

This is why both are flagged as invariants in `CLAUDE.md` and `EXPLANATION.md` §13.

### Q33. The backend container has the Docker socket mounted. Isn't that effectively root on the host?

Yes — anyone with write access to `/var/run/docker.sock` can `docker run --privileged -v /:/host ...` and have host-root. So the protections that matter are:

1. The backend is **not exposed publicly** (no `ports:` block in Compose). Only nginx is. From outside the Docker network you cannot reach the backend.
2. nginx only proxies `/api/` and `/health` from `localhost` to the backend. There is no path from a browser to `docker.sock` except through endpoints we've written.
3. Every API operation is **scoped to the `managed-by` label**. Even if a request reached a hypothetical "execute arbitrary docker command" endpoint, we don't have one. The service exposes `run_container` with fixed labels, and list/stop/remove only see labeled containers.

In a real deployment, you'd add auth at nginx, run the backend as a non-root user in a user namespace, and consider rootless Docker.

### Q34. Why does `list_managed_containers` use `filters={"label": "managed-by=..."}` instead of pulling all containers and filtering in Python?

Two reasons:

- **Efficiency.** The label filter is applied by the Docker daemon over its internal index. If the host has hundreds of unrelated containers, we don't transfer their metadata over the socket.
- **Correctness as a hard guarantee.** Filtering in Python means a bug in the filter expression can leak unmanaged containers into the result. Filtering at the daemon means the only way to see an unmanaged container is to ask for one by name (`get_container`), which we only ever do with a name we constructed ourselves.

### Q35. Walk through how `_try_reuse_existing_environment` handles a "broken" exited container and why each branch is needed.

```python
def _try_reuse_existing_environment(self, container):
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
    # ... build response with reused=True
```

- **Status `running`** → no `start` call, no wait, just return. Costs zero daemon round-trips beyond the lookup.
- **Status `exited`** → call `start`, set `just_started=True`. Re-`reload` to get the new status.
- **`start` raises** (image was deleted under us, volume gone, host out of resources) → remove the broken container and return `None`. The caller (`create_environment`) interprets `None` as "fall through to fresh provision". The user gets a working env even if the prior one was poisoned.
- **`just_started=True`** → call `self._wait_for_ready(container.name)`. This polls `http://<container_name>:3000/` from the backend (same Docker network) until openvscode-server actually answers. Docker says "running" the instant the init process starts, but openvscode takes ~1-2s more to bind the port — without this wait the dashboard's "Start & open" flow gets a 502 the moment it tries to open the URL.

Returning `None` rather than raising lets the caller distinguish "reused successfully" from "couldn't reuse, please make a new one" without an exception-as-control-flow pattern. And the `just_started` flag scopes the readiness wait to the case that needs it — already-running reuses skip it (the server is long since listening), and a failure inside `_wait_for_ready` is silent (see Q31).

### Q36. What's the threading model? Can two simultaneous requests for the same `mount_folder` end up creating two containers?

There's a small race window. Two requests both call `_find_existing_environment_by_mount_folder("demo")` at the same time, both see no existing container, both compute distinct UUIDs, both try `containers.run`. The second one **may** still succeed (different names) and we'd have two containers both bind-mounting `workspaces/demo/`.

In practice it's rare (the race is microseconds wide vs the seconds-long pull/start) and the second container's name avoids the collision branch entirely. Fixing it properly would need either a Python-side lock keyed on `mount_folder` or a "find or create with `mount_folder` as a name uniqueness key" pattern. For a local-dev tool that's acceptable; for production I'd take the lock.

### Q37. Why are `EnvironmentResponse` and the actual route return type both `dict`?

The schema `EnvironmentResponse` exists in `schemas/environment.py` but the route annotates the return type as plain `dict`. Pragmatic gap: the service builds dicts directly (faster, fewer model conversions), and FastAPI's response validation is opt-in via `response_model=...` which we don't use. The trade-off is that the OpenAPI spec for these endpoints is a free-form object. For a tighter contract you'd add `response_model=EnvironmentResponse` to each route and have the service return the model. For this scope I'd accept the looser contract.

### Q38. Pydantic v1 vs v2 — what changed that affects how this codebase is written?

Three big ones that show up here:

- **Performance and strictness.** v2's core is Rust (`pydantic-core`). Validators are faster and stricter by default — string regex no longer accepts integers coerced to strings, etc.
- **`Field(pattern=...)`** in v2 replaces `Field(regex=...)` from v1. Our `mount_folder` uses the v2 form.
- **`pydantic-settings`** is a **separate package** in v2 (was `pydantic.BaseSettings` in v1). That's why `requirements.txt` lists both `pydantic` and `pydantic-settings` and our config does `from pydantic_settings import BaseSettings`.

### Q39. Why is the Dockerfile structured `COPY requirements.txt`, `RUN pip install`, then `COPY app`?

Docker layer caching. Each `COPY`/`RUN` is a layer. Docker reuses a cached layer if the inputs are byte-identical. Editing a file in `app/` invalidates the `COPY app` layer but not the `pip install` layer above it, because that layer only depends on `requirements.txt`. So a code edit triggers a sub-second rebuild instead of re-pulling and re-installing every dependency.

If we copied everything in one `COPY . .` first, any code change would re-run pip install.

### Q40. Walk through what `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` does and why it's there.

GitHub Actions runs JavaScript actions on a Node runtime inside the runner. Historically actions declared their runtime as `node20`, but GitHub started migrating runners to `node24`. During the transition, some actions hadn't updated their `runs.using` declaration. The env var `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` is a GitHub-recognized override that runs all JS actions under Node 24 regardless of what they declare, sidestepping warnings/failures during the migration window. Safe to remove once all your dependent actions declare `node24`.

### Q41. The `docker compose config` step in CI provides four placeholder env vars. Why do we need them and what would fail without?

`docker-compose.yml` interpolates `${PUBLIC_BASE_URL}`, `${ENV_NETWORK}`, `${HOST_WORKSPACES_ROOT}`, and `${OPENVSCODE_IMAGE}`. `docker compose config` fails (or warns) when any are unset; in CI we have no `.env`. The job's `env:` block provides placeholders so substitution succeeds and the validate step actually validates the rest of the YAML schema. The placeholders don't need to be real — `compose config` doesn't pull images or check that `/tmp/vscode-workspaces` exists, it only parses and resolves.

### Q42. The service returns `{"reused": True}` on idempotent retries. Why is this useful from a client's perspective?

It separates two outcomes that *look* identical (200/201 with a container record): "I just spun up a brand-new environment, expect a 10–30s warm-up" vs "this was already up, you can navigate immediately." Without the flag, the client has to time the response to guess. With it, a frontend could show a different UI ("opening your existing workspace" vs "provisioning, please wait") and metrics can distinguish first-time vs reuse hits.

---

## EXPERT (43–50) — what you'd say to a principal engineer

### Q43. If I asked you to support 50 concurrent users with this design, what breaks first and how would you fix it?

In rough order of when it breaks:

1. **Image pull bottleneck.** `gitpod/openvscode-server` is ~600 MB; pulling 50× saturates the host disk. Fix: bake it into the host's image cache at startup, or use a `Pre-Pulled` init container.
2. **Disk and memory pressure.** 50 containers × Node + extensions ≈ multi-GB RAM. No `mem_limit`/`cpu_count` today — one runaway env crashes everyone. Fix: pass quotas to `containers.run`.
3. **The `mount_folder` race I described in Q36.** Becomes routine with concurrent clients. Fix: lock per mount_folder, or persistent state in a small store like SQLite/Redis.
4. **Backend single-process uvicorn.** No worker count means one request blocks Docker socket calls (sync `docker-py`) and others wait. The readiness wait inside the reuse path makes this sharper: every "Start & open" call holds the worker thread for up to 10 seconds while it polls the env container's `:3000`. With one worker, that's a global throughput cap of one start every ~1-2s. Fix: `uvicorn --workers N` (multiprocess) or `run_in_threadpool` for the blocking calls; longer term, make the readiness probe async with `httpx.AsyncClient`.
5. **No reaper.** Stale envs accumulate. Fix: a periodic task stops/removes envs idle for >N hours.
6. **No auth.** At 50 users this is no longer "single dev local tool". Fix: `auth_request` in nginx to an auth service or OIDC sidecar.

### Q44. The Docker socket mount is the security crown jewel. Walk me through every alternative and why we chose it.

| Option | What it is | Why we didn't |
|---|---|---|
| **Docker socket mount** (current) | `/var/run/docker.sock` into the backend; backend talks to the host daemon | Simple, all Docker features available, accepted single-dev-local risk |
| **Docker-in-Docker (DinD)** | Run a Docker daemon inside the backend container | Heavier (nested daemon), needs `--privileged`, env containers wouldn't share host net — nginx couldn't reach them |
| **Rootless Docker** | Daemon runs as non-root in user namespace | Best long-term; would need backend container to also be rootless; not yet a 5-minute drop-in |
| **Sysbox / gVisor** | Run env containers in a sandboxed runtime | Adds runtime-class config; doesn't change the socket issue |
| **Custom thin daemon proxy** | A tiny intermediate process exposes only `run`/`stop`/`remove`/`list` filtered by label | Cleanest defense-in-depth; would build for a real deployment |

For this assignment scope (`localhost`, no auth, single user), socket mount is the right call. For a real deployment I'd pair it with a custom daemon proxy whose entire surface is "create container with these labels, list/stop/remove only my labels."

### Q45. We use `unless-stopped` as the restart policy. But `docker stop` itself is graceful — it sends SIGTERM, waits 10s, then SIGKILL. Does openvscode-server handle SIGTERM cleanly, and does it matter for our data?

openvscode-server is a Node process that handles SIGTERM and flushes file watchers + closes WebSockets. But our data persistence is **independent** of in-container state: files live on the bind-mounted host folder. The container is stateless — its filesystem outside `/home/workspace` is throwaway. So even if SIGKILL truncates a write inside `/home/workspace`, the user's loss is the same as a brutal power-off of any editor: at most the unsaved file. We could tune `stop_timeout` if we wanted longer SIGTERM grace, but for our scope the default is fine.

### Q46. What's the smallest change you'd make to expose this on a real domain like `vscode.cymotive.dev` with HTTPS?

Five things, in order:

1. **DNS.** Wildcard `*.vscode.cymotive.dev` → the public IP of the host.
2. **Update `PUBLIC_BASE_URL`** to `https://vscode.cymotive.dev` so URL building puts the right scheme/host.
3. **Update the nginx regex** server_name: `~^(?<vscode_container>vscode-env-[a-f0-9]{12})\.vscode\.cymotive\.dev$`.
4. **Add TLS.** Swap nginx for **Caddy** for automatic Let's Encrypt — single-line config for a wildcard cert via DNS-01 challenge.
5. **Add auth** before exposing anything — even basic auth on the management API and per-env tokens in the URL would do for a v1.

The container-naming scheme + WebSocket headers + DNS resolver carry over unchanged.

### Q47. Walk me through the WebSocket lifecycle through the system and what would break if `proxy_http_version 1.1` were removed.

Without `proxy_http_version 1.1`, nginx defaults to HTTP/1.0 between itself and the upstream. HTTP/1.0 has no concept of the `Upgrade` header — it can't negotiate the WebSocket protocol switch. The first symptom: the browser sends `Upgrade: websocket`, nginx forwards it (the directive `proxy_set_header Upgrade $http_upgrade` puts it in the request) but the upstream sees HTTP/1.0 semantics. openvscode-server replies with `200 OK` instead of `101 Switching Protocols`; the WebSocket client treats that as failure, retries with exponential backoff, and you see the terminal/extension features fail to come online. The CPU+network cost of constant reconnects is its own problem.

`Connection: "upgrade"` is the other half — HTTP/1.1 lets intermediaries close connections via `Connection: close`, so we explicitly set `upgrade` so the connection is kept open through the protocol switch.

### Q48. What's the testing story when you can't fake out the actual Docker daemon — what *isn't* covered by your current tests?

Things our fakes can't catch:

- **Actual image pull failures** (network out, registry rate limit, manifest issues).
- **Actual bind mount failures** (SELinux/AppArmor denial, NFS quirks, permission mismatch between host UID and container UID).
- **Daemon API version skew** — docker-py 7.1 talking to a daemon older than the lowest supported API version.
- **Race conditions** — the concurrent `mount_folder` race in Q36.
- **nginx ↔ Docker DNS** — whether the embedded resolver actually returns NXDOMAIN fast enough that browsers don't hang.
- **WebSocket end-to-end** — that headers are forwarded correctly through every hop.
- **The readiness wait actually working.** We test that `_wait_for_ready` is called (via the injected no-op) but we don't test that the real HTTP probe correctly identifies "openvscode is listening." That requires a real container coming up — only an integration test would catch a regression like "we probe `:3001` instead of `:3000`."

For #5, #6, and #7 you really do need an integration test that runs `compose up`, hits the API, opens a WebSocket, and writes a file. I'd add it once the unit-test layer was stable.

### Q49. Suppose I gave you 24 hours to make this production-ready for a small team (~10 devs). What's your prioritized list?

1. **Auth.** OIDC at nginx via `auth_request` → a tiny oauth2-proxy container. Without this nothing else matters.
2. **Resource limits on env containers** (`mem_limit=4g`, `cpu_count=2`, `pids_limit=4096`).
3. **Persistent state.** SQLite or Postgres for env metadata so backend restart doesn't lose names/owners/labels. Today we rely entirely on Docker labels — fine for a tool, lossy for an audit log.
4. **Reaper.** APScheduler task: stop containers idle >12h, remove >7 days.
5. **Per-env subdomain auth token.** Generate a short-lived signed token at create time, embed in URL; nginx validates via `auth_request`. Stops "you sent your env URL in Slack" from being a credential leak.
6. **Structured logging + request IDs** end-to-end.
7. **TLS via Caddy** (Q46).
8. **An E2E smoke test in CI** that hits POST → GET → DELETE.
9. **Per-user namespacing** — `mount_folder` becomes `<user>/<name>`; collisions/listing scope to the caller.
10. **Monitoring** — `/metrics` Prometheus endpoint; one Grafana board.

### Q50. The assignment was to spin up VS Code containers. You added seven things that weren't asked for: a `managed-by` label, a `reused: bool` flag, defense-in-depth path checks, a `FakeDockerGateway` for tests, exception narrowing, a React dashboard with a "Start & open" flow for exited envs, and a backend readiness wait. Why are these worth the time?

Because they're the difference between code that demos and code that survives Monday morning. Specifically:

- **`managed-by` label** — the moment your tool runs on a real shared host, someone has other containers there. Without the label, an accidental `containers.list()` could touch them. The label is a five-minute investment that converts a sharp tool into a safe one.
- **`reused: bool`** — clients can produce different UX for "your env is here right now" vs "we just spawned one, give it 20s." Without it, you'd time the response and guess.
- **Defense-in-depth path checks** — the Pydantic regex is the boundary; the `_resolve_workspace_path` check is the wall behind it. The second one costs three lines and protects against the most common mistake — someone "improving" the regex without thinking about traversal.
- **`FakeDockerGateway`** — without it, the test suite either needs a real daemon (slow, flaky CI) or it monkeypatches `docker.from_env()` (brittle, leaks). A focused fake lets us cover the broken-container-replace branch and the stop-all failure branch in 1ms tests.
- **Exception narrowing** — `except Exception` would convert real bugs into 502s with no stack trace. By catching exactly the two `docker.errors` classes the SDK promises, real 500s carry their tracebacks through to the logs and we can debug.
- **React dashboard + "Start & open" flow** — without a UI, every demo is a curl command. Without the "Start & open" intercept, the first time a container is killed (Docker Desktop sleeps over the weekend, a container OOMs) the user clicks the URL, sees a 502, has no idea why, and has no obvious recovery path. The intercept turns a confusing failure into a one-click recovery.
- **Backend readiness wait** — Docker reporting `running` lies by ~1-2 seconds. The wait closes the race between "container started" and "openvscode bound `:3000`". Putting it in the backend (where it's on the manager network and can probe the container directly) is the only place a clean check fits — the frontend can't distinguish a 502 from a 200 over JS fetch due to CORS, and nginx has no concept of "wait until upstream is ready." It's the small invisible thing that makes the user-visible "Start & open" feel instantaneous instead of flaky.

None of these are over-engineering. Each one closes a specific failure mode I could name on the call.

---

## How to use this doc before the interview

1. **Read every question aloud and answer aloud** — saying it is different from thinking it.
2. **Skip the answer first.** If you can answer without looking, mark it ✅. If not, read the answer, then re-ask yourself 30 minutes later.
3. **Pick three Hard / Expert questions and pre-rehearse them**: Q29 (defending the `mount_folder` decision), Q33 (Docker socket = root), Q50 (why the extras). Those are the "tell me about a design decision you made" prompts.
4. **For every "why" answer, know the alternative.** Interviewers probe by saying "OK, but what if you did X instead?" Q44 is structured that way.

You've got this.
