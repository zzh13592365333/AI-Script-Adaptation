$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host '未检测到 Docker。' -ForegroundColor Red
    exit 1
}

docker compose stop
Write-Host '应用已停止，项目数据仍保留在 Docker Volume 中。' -ForegroundColor Green
