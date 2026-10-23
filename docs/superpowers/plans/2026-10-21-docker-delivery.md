# Docker Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the existing Vue and FastAPI application as a two-container Docker project exposed through one Nginx port.

**Architecture:** A multi-stage frontend image builds Vue assets and serves them through Nginx. Nginx proxies same-origin `/api` traffic to an internal FastAPI container whose SQLite files live in a named volume.

**Tech Stack:** Docker Compose, Node.js 22, Nginx Alpine, Python 3.12, Vue/Vite, FastAPI, SQLite

**Spec:** `docs/superpowers/specs/2026-10-21-docker-delivery-design.md`

## Global Constraints

- Do not embed or print real model credentials.
- Do not expose the backend container port to the host.
- Preserve local development commands and Mock mode.
- Persist both task and checkpoint SQLite databases under `/app/data`.
- Do not create Git commits.

## Review Focus

- Missing `.env`: the Windows launcher must create it from the example and stop with a clear message.
- Empty model credentials: Compose must remain syntactically valid and the backend health endpoint must report the unconfigured state.
- SPA deep links: Nginx must fall back to `index.html`.
- Backend startup lag: frontend health must remain independent while `/api` proxy recovers when the backend becomes healthy.
- Recreated containers: the named data volume must remain attached.

---

### Task 1: Production API Routing

**Files:**
- Modify: `.env.example`
- Modify: `src/features/ai/http-adapter.ts`
- Modify: `src/features/stage-reviews/client.ts`
- Modify: `src/features/script-tasks/client.ts`
- Test: relevant existing client tests

**Interfaces:**
- Consumes: Vite `VITE_API_BASE_URL` and `VITE_BACKEND_API_URL` variables.
- Produces: production-safe same-origin `/api` defaults while retaining development overrides.

- [ ] Add or update client tests asserting `/api` is accepted as the production base path.
- [ ] Run the targeted tests and confirm the old default expectation fails where applicable.
- [ ] Implement the minimal environment/default changes.
- [ ] Run targeted tests, type checking, and the production build.

### Task 2: Container Images and Compose Network

**Files:**
- Create: `Dockerfile.frontend`
- Create: `backend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `deploy/nginx.conf`
- Create: `.dockerignore`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: frontend `dist/`, backend `backend.app.main:app`, `/api/health`.
- Produces: `frontend:80`, internal `backend:8000`, host `${APP_PORT:-8080}`, and named volume `app-data`.

- [ ] Add a static deployment-contract test that checks proxy target, public ports, health checks, volume paths, and secret exclusions.
- [ ] Run the contract test and confirm it fails because deployment files are missing.
- [ ] Add the frontend and backend Dockerfiles, Nginx configuration, Compose services, health checks, and named volume.
- [ ] Add `.dockerignore` exclusions for secrets, databases, Git metadata, virtual environments, dependencies, and generated reports.
- [ ] Run the contract test and `docker compose config`.
- [ ] Build both images and run health checks when Docker is available.

### Task 3: One-Click Windows Operation

**Files:**
- Create: `启动应用.ps1`
- Create: `停止应用.ps1`
- Test: `tests/deployment/docker-delivery.test.ts`

**Interfaces:**
- Consumes: `.env.example`, `docker compose`, `${APP_PORT:-8080}`.
- Produces: safe first-run configuration flow, Docker availability checks, startup, browser opening, and non-destructive shutdown.

- [ ] Extend the deployment-contract test for missing-env behavior and non-destructive shutdown.
- [ ] Run the test and confirm it fails because scripts are missing.
- [ ] Implement scripts without embedding credentials or deleting volumes.
- [ ] Run the contract test and PowerShell parser validation.

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Test: all frontend, backend, E2E, deployment, build, privacy, and Compose checks

**Interfaces:**
- Consumes: all artifacts from Tasks 1-3.
- Produces: a recipient-facing setup, start, logs, update, backup, stop, and cleanup guide.

- [ ] Document Docker prerequisites, `.env` configuration, one-click and CLI startup, LAN/domain access, logs, backup, update, stop, and explicit volume deletion.
- [ ] Run frontend tests, type checking, production build, backend tests, and default E2E tests.
- [ ] Run Compose validation, image builds, container health checks, and page/API smoke checks when Docker is available.
- [ ] Scan tracked deliverables for legacy branding, credential patterns, private environment files, and generated databases.
