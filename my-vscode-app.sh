#!/usr/bin/env bash
#
# my-vscode-app.sh — one-shot launcher for the VS Code Web Environment Manager.
#
# Brings up the full stack (backend + nginx + per-env VS Code containers) using
# prebuilt multi-arch images from Docker Hub, waits until the backend is
# healthy, and prints the dashboard URL plus the API endpoint list.
#
# Usage:  ./my-vscode-app.sh
# Stop:   docker compose -f docker-compose.hub.yml down

set -euo pipefail

COMPOSE_FILE="docker-compose.hub.yml"
DASHBOARD_URL="http://localhost:8080"
HEALTH_URL="${DASHBOARD_URL}/health"
READINESS_TIMEOUT=60

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if ! command -v docker >/dev/null 2>&1; then
    echo "Error: 'docker' is not installed or not on PATH." >&2
    echo "Install Docker Desktop or Docker Engine, then re-run this script." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is not running." >&2
    echo "Start Docker Desktop (macOS/Windows) or the docker service (Linux), then re-run." >&2
    exit 1
fi

echo "Starting VS Code Web Environment Manager via ${COMPOSE_FILE}..."
docker compose -f "${COMPOSE_FILE}" up -d

printf "Waiting for backend to become ready"
deadline=$((SECONDS + READINESS_TIMEOUT))
until curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; do
    if (( SECONDS > deadline )); then
        printf "\n"
        echo "Backend did not become healthy within ${READINESS_TIMEOUT}s." >&2
        echo "Inspect logs with:  docker compose -f ${COMPOSE_FILE} logs" >&2
        exit 1
    fi
    printf "."
    sleep 1
done
printf "\n\n"

cat <<EOF
The application is up.

  Dashboard: ${DASHBOARD_URL}

  API endpoints (prefix with ${DASHBOARD_URL}):
    GET    /health                          Backend liveness check
    GET    /api/docker/info                 Docker daemon connectivity + version
    POST   /api/environments                Create a VS Code environment (body: {"mount_folder":"demo"})
    GET    /api/environments                List all managed environments
    GET    /api/environments/{id}           Inspect one environment
    POST   /api/environments/{id}/stop      Stop one environment
    POST   /api/environments/stop-all       Stop every running environment
    DELETE /api/environments/{id}           Remove an environment

  Stop the stack:  docker compose -f ${COMPOSE_FILE} down
EOF
