$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host 'Created .env. Configure the model endpoint, API key, and model name, then run this script again.' -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'Docker was not found. Install and start Docker Desktop first.' -ForegroundColor Red
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker is not running. Start Docker Desktop and try again.' -ForegroundColor Red
    exit 1
}

$appPort = 8080
Get-Content -LiteralPath '.env' | ForEach-Object {
    if ($_ -match '^APP_PORT\s*=\s*(\d+)\s*$') { $appPort = [int]$Matches[1] }
}

docker compose config --quiet
docker compose up -d --build

$url = "http://localhost:$appPort"
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
        $response = Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Start-Process $url
            Write-Host "Application started: $url" -ForegroundColor Green
            exit 0
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

Write-Host 'Containers started, but the page health check timed out. Run docker compose logs for details.' -ForegroundColor Yellow
exit 1
