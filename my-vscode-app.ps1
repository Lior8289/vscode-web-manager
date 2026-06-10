#Requires -Version 5.1
#
# my-vscode-app.ps1 — Windows launcher for the VS Code Web Environment Manager.
#
# Equivalent to my-vscode-app.sh: brings up docker-compose.hub.yml in detached
# mode, polls /health until the backend is ready, and prints the dashboard URL
# plus the API endpoint list.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\my-vscode-app.ps1
# Stop:   docker compose -f docker-compose.hub.yml down

$ErrorActionPreference = 'Stop'

$ComposeFile      = 'docker-compose.hub.yml'
$DashboardUrl     = 'http://localhost:8080'
$HealthUrl        = "$DashboardUrl/health"
$ReadinessTimeout = 60

# Run from the script's own directory so docker compose resolves the file.
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'docker' is not installed or not on PATH." -ForegroundColor Red
    Write-Host "Install Docker Desktop, then re-run this script."
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker daemon is not running." -ForegroundColor Red
    Write-Host "Start Docker Desktop, then re-run this script."
    exit 1
}

Write-Host "Starting VS Code Web Environment Manager via $ComposeFile..."
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: 'docker compose up' failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host -NoNewline "Waiting for backend to become ready"
$deadline = (Get-Date).AddSeconds($ReadinessTimeout)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # backend not yet listening; keep polling
    }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 1
}
Write-Host ""

if (-not $ready) {
    Write-Host "Backend did not become healthy within $ReadinessTimeout seconds." -ForegroundColor Red
    Write-Host "Inspect logs with:  docker compose -f $ComposeFile logs"
    exit 1
}

Write-Host ""
Write-Host "The application is up."
Write-Host ""
Write-Host "  Dashboard: $DashboardUrl"
Write-Host ""
Write-Host "  API endpoints (prefix with $DashboardUrl):"
Write-Host "    GET    /health                          Backend liveness check"
Write-Host "    GET    /api/docker/info                 Docker daemon connectivity + version"
Write-Host "    POST   /api/environments                Create a VS Code environment (body: {`"mount_folder`":`"demo`"})"
Write-Host "    GET    /api/environments                List all managed environments"
Write-Host "    GET    /api/environments/{id}           Inspect one environment"
Write-Host "    POST   /api/environments/{id}/stop      Stop one environment"
Write-Host "    POST   /api/environments/stop-all       Stop every running environment"
Write-Host "    DELETE /api/environments/{id}           Remove an environment"
Write-Host ""
Write-Host "  Stop the stack:  docker compose -f $ComposeFile down"
