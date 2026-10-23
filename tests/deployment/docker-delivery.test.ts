import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Docker delivery contract', () => {
  it('defines frontend and backend images behind one public port', () => {
    for (const path of ['Dockerfile.frontend', 'backend/Dockerfile', 'docker-compose.yml', 'deploy/nginx.conf']) {
      expect(existsSync(resolve(root, path)), `${path} should exist`).toBe(true)
    }
    const compose = read('docker-compose.yml')
    const backendBlock = compose.split(/^  frontend:\s*$/m)[0]
    expect(compose).toContain('frontend:')
    expect(compose).toContain('backend:')
    expect(compose).toContain('${APP_PORT:-8080}:80')
    expect(compose).toContain('app-data:/app/data')
    expect(backendBlock).not.toMatch(/^    ports:\s*$/m)
    expect(compose).toContain('condition: service_healthy')
  })

  it('routes the SPA and streaming API through nginx', () => {
    const nginx = read('deploy/nginx.conf')
    expect(nginx).toContain('try_files $uri $uri/ /index.html')
    expect(nginx).toContain('proxy_pass http://backend:8000')
    expect(nginx).toContain('proxy_buffering off')
    expect(nginx).toContain('location = /health')
  })

  it('excludes secrets and generated local state from image contexts', () => {
    const ignore = read('.dockerignore')
    for (const pattern of ['.env', '.env.local', 'backend/.env', '.git', 'node_modules', 'backend/.venv', 'backend/data', '*.sqlite3']) {
      expect(ignore).toContain(pattern)
    }
  })

  it('provides non-destructive Windows start and stop scripts', () => {
    const start = read('启动应用.ps1')
    const stop = read('停止应用.ps1')
    expect(start).toContain("Copy-Item -LiteralPath '.env.example' -Destination '.env'")
    expect(start).toContain('docker compose up -d --build')
    expect(start).toContain('http://localhost:$appPort')
    expect(stop).toContain('docker compose stop')
    expect(stop).not.toContain('down -v')
  })
})
