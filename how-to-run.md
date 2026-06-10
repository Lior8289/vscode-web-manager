# How To Run VS Code Web Environment Manager

This guide shows the exact terminal commands to run the project.

The project folder is:

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager"
```

Run all commands from macOS Terminal, iTerm, VS Code terminal, or another shell. Do not type these commands inside Python, Node, or Docker Desktop.

---

## 1. Prerequisites

You need Docker Desktop running.

Check from Terminal:

```bash
docker --version
docker compose version
```

Optional, but useful for pretty JSON output:

```bash
jq --version
```

If `jq` is missing on macOS:

```bash
brew install jq
```

If you do not want to install `jq`, remove `| jq` from the commands below.

---

## 2. Recommended Demo Run: Use Prebuilt Docker Hub Images

This is the fastest way to run the project. It does not build the backend or frontend locally.

### Step 1: Go To The Project Folder

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager"
```

### Step 2: Start The App

```bash
docker compose -f docker-compose.hub.yml up
```

This pulls and starts:

- `lior8289/vscode-web-manager-backend:latest`
- `lior8289/vscode-web-manager-frontend:latest`

Leave this terminal window open. It is showing the application logs.

### Step 3: Open The Dashboard

Open this URL in your browser:

```text
http://localhost:8080
```

In the UI:

1. Click `New environment`.
2. Enter a workspace name, for example:

```text
demo
```

3. Click `Provision`.
4. Open the returned environment URL.

The editor URL will look like this:

```text
http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace
```

Files created inside VS Code under `/home/workspace` are stored on the host under:

```text
/tmp/vscode-web-manager-workspaces/demo
```

### Step 4: Stop The App

In the terminal where `docker compose ... up` is running, press:

```text
Ctrl-C
```

Then remove the backend/nginx containers:

```bash
docker compose -f docker-compose.hub.yml down
```

Important: `docker compose down` removes the backend and nginx containers, but it does not remove the dynamically created `vscode-env-*` environment containers. See the cleanup section below.

---

## 3. Source Build Run: Build From This Repository

Use this when you want to run the exact local source code.

### Step 1: Go To The Project Folder

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager"
```

### Step 2: Create `.env`

```bash
cp .env.example .env
```

The default `.env.example` works out of the box:

```text
PUBLIC_BASE_URL=http://localhost:8080
ENV_NETWORK=vscode-manager-net
HOST_WORKSPACES_ROOT=/tmp/vscode-web-manager-workspaces
OPENVSCODE_IMAGE=gitpod/openvscode-server
```

Optional: if you want workspaces to persist somewhere under your home folder:

```bash
mkdir -p "$HOME/vscode-web-manager-workspaces"
```

Then edit `.env` and set:

```text
HOST_WORKSPACES_ROOT=/Users/liormorali/vscode-web-manager-workspaces
```

### Step 3: Build And Start

Foreground mode, with logs in the terminal:

```bash
docker compose up --build
```

Detached/background mode:

```bash
docker compose up -d --build
```

### Step 4: Open The Dashboard

```text
http://localhost:8080
```

### Step 5: Stop The Source-Build Stack

If running in foreground, press:

```text
Ctrl-C
```

Then:

```bash
docker compose down
```

If running detached:

```bash
docker compose down
```

---

## 4. Useful Terminal Commands While The App Is Running

Run these from:

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager"
```

### Check Running Services

```bash
docker compose ps
```

For the Docker Hub compose file:

```bash
docker compose -f docker-compose.hub.yml ps
```

### Follow Logs

Source build:

```bash
docker compose logs -f
```

Docker Hub run:

```bash
docker compose -f docker-compose.hub.yml logs -f
```

Backend only:

```bash
docker compose logs -f backend
```

nginx only:

```bash
docker compose logs -f nginx
```

### Restart Services

```bash
docker compose restart backend
docker compose restart nginx
```

### Validate Compose Configuration

```bash
PUBLIC_BASE_URL=http://localhost:8080 \
ENV_NETWORK=vscode-manager-net \
HOST_WORKSPACES_ROOT=/tmp/vscode-web-manager-workspaces \
OPENVSCODE_IMAGE=gitpod/openvscode-server \
docker compose config --quiet
```

---

## 5. Use The API From Terminal

These examples use the public nginx entry point:

```text
http://localhost:8080/api
```

### Health Check

```bash
curl -s http://localhost:8080/health | jq
```

Expected:

```json
{
  "status": "ok"
}
```

### Docker Info

```bash
curl -s http://localhost:8080/api/docker/info | jq
```

### Create An Environment

```bash
curl -s -X POST http://localhost:8080/api/environments \
  -H "Content-Type: application/json" \
  -d '{"mount_folder":"demo"}' | jq
```

Example response:

```json
{
  "id": "abc123def456",
  "container_name": "vscode-env-abc123def456",
  "status": "running",
  "url": "http://vscode-env-abc123def456.localhost:8080?folder=%2Fhome%2Fworkspace",
  "workspace_path": "/tmp/vscode-web-manager-workspaces/demo",
  "reused": false
}
```

Open the `url` value in your browser.

### List Environments

```bash
curl -s http://localhost:8080/api/environments | jq
```

### Save The Environment ID Into A Shell Variable

If you have `jq`:

```bash
ENV_ID=$(curl -s http://localhost:8080/api/environments | jq -r '.[0].id')
echo "$ENV_ID"
```

If the output is empty or `null`, create an environment first.

### Get Environment Details

```bash
curl -s "http://localhost:8080/api/environments/$ENV_ID" | jq
```

### Stop One Environment

```bash
curl -s -X POST "http://localhost:8080/api/environments/$ENV_ID/stop" | jq
```

### Restart A Stopped Environment

Call create again with the same `mount_folder`:

```bash
curl -s -X POST http://localhost:8080/api/environments \
  -H "Content-Type: application/json" \
  -d '{"mount_folder":"demo"}' | jq
```

The response should include:

```json
{
  "reused": true
}
```

### Stop All Environments

```bash
curl -s -X POST http://localhost:8080/api/environments/stop-all | jq
```

### Delete One Environment Container

```bash
curl -s -X DELETE "http://localhost:8080/api/environments/$ENV_ID" | jq
```

This removes the container, but it does not delete the workspace folder from the host.

---

## 6. Cleanup Commands

### Stop The Compose Stack

Source build:

```bash
docker compose down
```

Docker Hub run:

```bash
docker compose -f docker-compose.hub.yml down
```

### Remove All Managed VS Code Environment Containers

This removes all dynamically created `vscode-env-*` containers managed by the app:

```bash
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f
```

### Remove Workspace Files

Default workspace location:

```bash
rm -rf /tmp/vscode-web-manager-workspaces
```

Only run that command if you are sure you do not need the files inside those workspaces.

### Pull Fresh Docker Hub Images

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up
```

---

## 7. Run Backend Locally Without Docker Compose

Use this for backend development. This does not run nginx, so editor subdomain routing will not work through `localhost:8080`.

### Step 1: Go To Backend Folder

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/backend"
```

### Step 2: Create And Activate Python Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

If `.venv` already exists:

```bash
source .venv/bin/activate
```

### Step 3: Install Dependencies

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r requirements-dev.txt
```

### Step 4: Run FastAPI

```bash
uvicorn app.main:app --reload --port 8000
```

Open:

```text
http://localhost:8000/docs
```

Test:

```bash
curl -s http://localhost:8000/health | jq
```

---

## 8. Run Frontend Locally With Vite

Use this for frontend development.

The Vite dev server runs on:

```text
http://localhost:5173
```

It proxies `/api` to:

```text
http://localhost:8000
```

So start the backend locally first.

### Terminal 1: Backend

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/backend"
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### Terminal 2: Frontend

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/frontend"
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Important: Vite dev mode is good for the dashboard, but the full editor subdomain routing is handled by nginx in Docker. For the complete system, use Docker Compose.

---

## 9. Run Tests And Checks

### Backend

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/backend"
source .venv/bin/activate
python -m ruff check .
python -m pytest
```

Expected current result:

```text
36 passed
```

### Frontend

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager/frontend"
npm install
npm run lint
npm run typecheck
npm run build
```

---

## 10. Common Problems

### Docker Is Not Running

Symptom:

```text
Cannot connect to the Docker daemon
```

Fix:

1. Open Docker Desktop.
2. Wait until Docker says it is running.
3. Run the command again.

### Port 8080 Is Already In Use

Symptom:

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

Find the process:

```bash
lsof -i :8080
```

Stop the other service or change the Compose port mapping.

### Environment URL Shows 502

Possible causes:

- openvscode-server is still starting.
- The environment container is stopped.
- nginx cannot resolve the container name.

Try:

```bash
docker ps -a --filter label=managed-by=vscode-web-env-manager
docker compose logs --tail 100 nginx
docker compose logs --tail 100 backend
```

If the environment is stopped, restart it by creating the same `mount_folder` again:

```bash
curl -s -X POST http://localhost:8080/api/environments \
  -H "Content-Type: application/json" \
  -d '{"mount_folder":"demo"}' | jq
```

### `jq` Not Found

Remove `| jq` from the command, or install it:

```bash
brew install jq
```

### Clean Everything And Start Again

```bash
cd "/Users/liormorali/Documents/Lior/Career/Cymotive/vscode-web-manager"
docker compose down
docker compose -f docker-compose.hub.yml down
docker ps -aq --filter label=managed-by=vscode-web-env-manager | xargs -r docker rm -f
rm -rf /tmp/vscode-web-manager-workspaces
docker compose up --build
```

