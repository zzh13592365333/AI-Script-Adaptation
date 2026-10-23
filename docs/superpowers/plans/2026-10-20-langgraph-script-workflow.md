# LangGraph Script Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable FastAPI, LangChain, and LangGraph backend for episode-script generation, quality review, bounded revision, human approval, cancellation, recovery, and version history while preserving the current Vue workflow.

**Architecture:** The Vue application keeps its existing project model, local persistence, and stages one through four. Stage five optionally uses a typed REST client backed by a FastAPI task service; that service runs a LangGraph workflow through a bounded local executor, persists business state and immutable versions in SQLite, and persists graph checkpoints with the SQLite checkpointer.

**Tech Stack:** Python 3.12, FastAPI 0.150.0, Pydantic 2, pydantic-settings 2.16.0, LangChain 1.4.6, langchain-openai 1.7.2, LangGraph 1.2.16, langgraph-checkpoint-sqlite 3.1.2, SQLite, pytest, Vue 3, TypeScript, Pinia, Vitest, Playwright.

**Spec:** `docs/architecture/2026-10-20-langgraph-backend-design.md`

## Global Constraints

- Preserve the current Vue pages, stages one through four, project JSON schema version 1, local import/export, and Mock AI behavior.
- Migrate only episode generation and rewrite to the durable backend in this release.
- Keep provider credentials exclusively in backend environment variables and never return or log them.
- Use SQLite only as a clearly documented local-development persistence option.
- Use a bounded local executor; do not add Redis, Celery, PostgreSQL, accounts, or media providers.
- Treat quality failure and technical failure as different states.
- Reaching `max_retries` must produce `awaiting_human_review`, never a false quality pass.
- Automated tests must use deterministic fake models and consume no real API quota.
- Preserve existing user changes and do not replace `.env.local`.

## Review Focus

- Restart with a task in `running`: startup recovery must resume from its checkpoint or move it to an explicit recoverable state without silently rerunning a persisted completed version; covered in Task 5.
- Duplicate review submission: an idempotency check must prevent two approved versions for the same task version; covered in Task 5.
- Cancellation during a provider call: cancellation must be persisted and must prevent subsequent workflow nodes from running even if the provider call returns; covered in Task 5.
- Oversized context or retry values: API validation must reject them before task persistence or model invocation; covered in Task 2 and Task 5.
- Legacy imported project without backend task metadata: frontend restore and script editing must continue to work; covered in Task 6.

---

## File Structure

### Backend

- `backend/pyproject.toml`: pinned runtime and test dependencies plus pytest configuration.
- `backend/.env.example`: backend-only provider, database, CORS, limits, and concurrency settings.
- `backend/app/main.py`: FastAPI construction, lifespan, CORS, and router registration.
- `backend/app/core/config.py`: cached Pydantic settings.
- `backend/app/models/script_task.py`: request, state, response, quality, and version models.
- `backend/app/models/review.py`: review action request model.
- `backend/app/repositories/database.py`: SQLite connection and schema initialization.
- `backend/app/repositories/task_repository.py`: task CRUD and compare-and-set transitions.
- `backend/app/repositories/version_repository.py`: immutable version writes and reads.
- `backend/app/services/model_provider.py`: LangChain provider protocol, OpenAI-compatible provider, and deterministic fake.
- `backend/app/services/task_service.py`: task lifecycle, bounded execution, cancellation, recovery, and review resume.
- `backend/app/workflows/state.py`: compact LangGraph state.
- `backend/app/workflows/validators.py`: deterministic script validation.
- `backend/app/workflows/script_graph.py`: nodes, routing, interrupts, and compiled graph.
- `backend/app/tools/contracts.py`: typed future-media tool contracts only.
- `backend/app/api/health.py`: health endpoint.
- `backend/app/api/script_tasks.py`: task REST endpoints.
- `backend/tests/`: model, repository, workflow, API, recovery, and contract tests.

### Frontend

- `src/features/script-tasks/types.ts`: backend API contract types.
- `src/features/script-tasks/client.ts`: typed REST client and polling helper.
- `src/domain/project.ts`: optional backend metadata on `EpisodeScript`.
- `src/stores/workflow.ts`: backend task orchestration for stage five with current adapter fallback.
- `src/views/ScriptGenerationView.vue`: task stage, retry, quality, error, review, and history UI.
- `src/components/episodes/ScriptReviewPanel.vue`: review details and actions.
- `src/components/episodes/ScriptVersionHistory.vue`: immutable version list.
- `vite.config.ts`: development proxy for the FastAPI API.
- `.env.example`: frontend backend-mode settings without secrets.
- `tests/unit/script-task-client.test.ts`: API client contract.
- `tests/unit/script-generation.test.ts`: Pinia and UI workflow compatibility.
- `tests/e2e/workflow.spec.ts`: current Mock workflow remains operational.

### Documentation

- `README.md`: combined frontend/backend setup, database initialization, API use, and limitations.
- `.gitignore`: backend virtual environment, database, caches, coverage, and generated artifacts.

### Task 1: Backend Runtime, Configuration, and Health Check

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/api/health.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Settings`, `get_settings() -> Settings`, `create_app(settings: Settings | None = None) -> FastAPI`.
- Produces: `GET /api/health` returning `{status, service, database, model_configured}` without secrets.

- [ ] **Step 1: Add a failing health endpoint test**

Create `test_health_reports_backend_without_exposing_secrets()` asserting HTTP 200, `status == "ok"`, and absence of API key fields.

- [ ] **Step 2: Run the health test and verify the backend package is missing**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_health.py -v`

Expected: FAIL because `backend.app.main` does not exist.

- [ ] **Step 3: Add pinned backend dependencies and settings**

Use Python `>=3.12,<3.13`. Pin FastAPI `0.150.0`, Uvicorn `0.54.0`, LangChain `1.4.6`, langchain-openai `1.7.2`, LangGraph `1.2.16`, langgraph-checkpoint-sqlite `3.1.2`, and pydantic-settings `2.16.0`; include pytest, pytest-asyncio, and httpx as test dependencies.

`Settings` must define `database_path`, `checkpoint_path`, `model_base_url`, `model_api_key`, `model_name`, `model_reasoning_effort`, `cors_origins`, `max_concurrent_tasks`, `max_input_chars`, and `default_max_retries`.

- [ ] **Step 4: Implement the app factory and health router**

The health response reports whether provider settings are present but never includes their values.

- [ ] **Step 5: Run the health test and backend import check**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_health.py -v`

Run: `backend\.venv\Scripts\python.exe -c "from backend.app.main import create_app; print(create_app().title)"`

Expected: PASS and application title output.

- [ ] **Step 6: Commit the backend scaffold**

```bash
git add backend .gitignore
git commit -m "feat: add fastapi backend scaffold"
```

### Task 2: Pydantic Models and SQLite Repositories

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/script_task.py`
- Create: `backend/app/models/review.py`
- Create: `backend/app/repositories/__init__.py`
- Create: `backend/app/repositories/database.py`
- Create: `backend/app/repositories/task_repository.py`
- Create: `backend/app/repositories/version_repository.py`
- Create: `backend/tests/test_models.py`
- Create: `backend/tests/test_repositories.py`

**Interfaces:**
- Produces: `TaskStatus`, `TaskStage`, `QualityCheckResult`, `ScriptTaskCreate`, `ScriptTaskRecord`, `ScriptTaskResponse`, `ScriptVersion`, `ReviewRequest`.
- Produces: `Database.initialize()`, `TaskRepository.create/get/update/claim/cancel/list_recoverable`, and `VersionRepository.append/list_for_task/latest`.

- [ ] **Step 1: Write failing model validation tests**

Test `episode_number >= 1`, `target_words` in `300..5000`, `max_retries` in `0..5`, each context within configured request bounds, valid review actions, and status serialization.

- [ ] **Step 2: Write failing repository tests**

Test task round-trip, compare-and-set status transition, cancellation flag, immutable version numbering, duplicate version idempotency key rejection, and recovery query.

- [ ] **Step 3: Run the model and repository tests to verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_models.py backend/tests/test_repositories.py -v`

- [ ] **Step 4: Implement Pydantic models**

Use string enums for API stability. `QualityCheckResult` contains the eight named compliance dimensions, `passed`, `issues`, and `revision_instructions`.

- [ ] **Step 5: Implement SQLite schema and repositories**

Use standard `sqlite3`, parameterized SQL, WAL mode, foreign keys, UTC ISO timestamps, and explicit transactions. Do not store provider credentials or full provider responses.

- [ ] **Step 6: Run repository tests and inspect a temporary database**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_models.py backend/tests/test_repositories.py -v`

Expected: PASS.

- [ ] **Step 7: Commit durable task models**

```bash
git add backend/app/models backend/app/repositories backend/tests/test_models.py backend/tests/test_repositories.py
git commit -m "feat: add durable script task models"
```

### Task 3: LangChain Model Provider and Structured Outputs

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/model_provider.py`
- Create: `backend/app/services/prompts.py`
- Create: `backend/tests/test_model_provider.py`

**Interfaces:**
- Produces: `ScriptModelProvider` protocol with `generate_script(request) -> str`, `revise_script(request) -> str`, and `review_script(request) -> QualityCheckResult`.
- Produces: `OpenAICompatibleProvider(settings: Settings)` and `FakeScriptModelProvider(script_results, review_results, failures)`.

- [ ] **Step 1: Write failing fake-provider and structured-review tests**

Test deterministic result sequencing, invalid structured review rejection, provider timeout classification, and sanitized provider errors.

- [ ] **Step 2: Run the provider tests to verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_model_provider.py -v`

- [ ] **Step 3: Implement prompts and provider protocol**

Generation prompts require scene headings, cast, action, Chinese dialogue/OS, adjacent English translations, terminology consistency, and target length. Review prompts return `QualityCheckResult` through LangChain structured output.

- [ ] **Step 4: Implement the OpenAI-compatible provider**

Initialize `ChatOpenAI` with backend base URL, API key, model, timeout, and retry limits. Map timeout, rate-limit, invalid-output, and network failures to stable internal error codes without including credentials.

- [ ] **Step 5: Implement the deterministic fake provider**

The fake provider records calls and returns queued outputs so graph tests can assert exact revision counts without real model usage.

- [ ] **Step 6: Run provider tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_model_provider.py -v`

Expected: PASS.

- [ ] **Step 7: Commit the provider layer**

```bash
git add backend/app/services backend/tests/test_model_provider.py
git commit -m "feat: add langchain model provider"
```

### Task 4: LangGraph Generation, Validation, Review, and Revision

**Files:**
- Create: `backend/app/workflows/__init__.py`
- Create: `backend/app/workflows/state.py`
- Create: `backend/app/workflows/validators.py`
- Create: `backend/app/workflows/script_graph.py`
- Create: `backend/tests/test_validators.py`
- Create: `backend/tests/test_script_graph.py`

**Interfaces:**
- Produces: `ScriptWorkflowState` containing identifiers, minimal generation context, draft, quality result, retry counters, cancellation flag, and sanitized error fields.
- Produces: `validate_script(content: str, request: ScriptTaskCreate) -> list[str]`.
- Produces: `build_script_graph(provider, checkpointer, cancellation_check) -> CompiledStateGraph`.

- [ ] **Step 1: Write failing deterministic validator tests**

Cover missing scene heading, missing cast, missing English translation for Chinese dialogue/OS, length outside tolerance, valid bilingual script, and malformed empty content.

- [ ] **Step 2: Write failing graph path tests**

Cover quality pass to human interrupt, quality failure then successful revision, retry exhaustion to human interrupt with `passed == false`, deterministic validation failure before review, provider failure, and cancellation routing.

- [ ] **Step 3: Run validator and graph tests to verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_validators.py backend/tests/test_script_graph.py -v`

- [ ] **Step 4: Implement compact workflow state and validators**

Do not include API credentials, raw provider responses, unrelated project episodes, or complete project JSON in graph state.

- [ ] **Step 5: Implement graph nodes and conditional routing**

Use public LangGraph 1.x APIs. Check cancellation before and after each provider call. Increment retries only for business-quality revision attempts, not technical retries.

- [ ] **Step 6: Add SQLite checkpointer integration in graph tests**

Use a temporary checkpoint database and stable `thread_id == task_id`. Assert interrupted state can be loaded and resumed with a human review command.

- [ ] **Step 7: Run workflow tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_validators.py backend/tests/test_script_graph.py -v`

Expected: PASS.

- [ ] **Step 8: Commit the LangGraph workflow**

```bash
git add backend/app/workflows backend/tests/test_validators.py backend/tests/test_script_graph.py
git commit -m "feat: add langgraph script review workflow"
```

### Task 5: Task Service, Recovery, Review, and REST API

**Files:**
- Create: `backend/app/services/task_service.py`
- Create: `backend/app/api/script_tasks.py`
- Create: `backend/tests/test_task_service.py`
- Create: `backend/tests/test_script_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `TaskService.create_task`, `get_task`, `get_result`, `list_versions`, `submit_review`, `regenerate`, `cancel`, `recover_pending`, `shutdown`.
- Produces the eight REST routes defined in the design under `/api`.

- [ ] **Step 1: Write failing service lifecycle tests**

Cover immediate task ID return, successful background completion to human review, restart recovery, no duplicate expensive call after persisted version, cancellation during provider return, duplicate review idempotency, edited acceptance, and revision feedback resume.

- [ ] **Step 2: Write failing API tests**

Cover 202 task creation, 404 unknown task, 409 invalid transition, 422 oversized input and retry values, sanitized model failure, status progress fields, result, versions, review, regeneration, and cancel.

- [ ] **Step 3: Run service and API tests to verify failure**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_task_service.py backend/tests/test_script_api.py -v`

- [ ] **Step 4: Implement bounded execution and task lifecycle**

Use `ThreadPoolExecutor(max_workers=settings.max_concurrent_tasks)`. Repository state is authoritative. On startup, `recover_pending()` resubmits recoverable tasks through their existing checkpoint.

- [ ] **Step 5: Implement review and version transitions**

Accept creates an immutable approved version. Edited accept stores the supplied content as a user version. Request revision resumes the graph with feedback. All transitions use compare-and-set status checks.

- [ ] **Step 6: Implement API routes and application lifespan**

Initialize database and checkpoint storage before serving, call recovery during startup, and shut down the executor cleanly.

- [ ] **Step 7: Run all backend tests**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests -v`

Expected: PASS with no network calls.

- [ ] **Step 8: Commit the durable task API**

```bash
git add backend/app/api backend/app/services/task_service.py backend/app/main.py backend/tests
git commit -m "feat: add durable script task api"
```

### Task 6: Frontend Script Task Client and Store Integration

**Files:**
- Create: `src/features/script-tasks/types.ts`
- Create: `src/features/script-tasks/client.ts`
- Create: `tests/unit/script-task-client.test.ts`
- Modify: `src/domain/project.ts`
- Modify: `src/stores/workflow.ts`
- Modify: `tests/unit/script-generation.test.ts`
- Modify: `.env.example`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `ScriptTaskClient` with `create`, `get`, `result`, `versions`, `review`, `regenerate`, `cancel`, and `waitForReview`.
- Adds optional `taskId`, `taskStatus`, `taskStage`, `retryCount`, `qualityCheck`, and `versions` metadata to `EpisodeScript` without changing `schemaVersion`.
- Adds `setScriptTaskClient(client)`, `reviewScriptTask`, and `loadScriptVersions` store actions.

- [ ] **Step 1: Write failing API client contract tests**

Mock `fetch` and assert request paths, JSON bodies, polling terminal states, cancellation, timeout cleanup, and sanitized API error handling.

- [ ] **Step 2: Extend existing script store tests before implementation**

Cover backend task creation, visible progress updates, draft preservation at human review, accept, edited accept, requested revision, cancel, API failure, and legacy project without task metadata.

- [ ] **Step 3: Run targeted frontend tests to verify failure**

Run: `npm test -- tests/unit/script-task-client.test.ts tests/unit/script-generation.test.ts`

- [ ] **Step 4: Implement client types and polling**

Use `VITE_SCRIPT_WORKFLOW=backend` and `VITE_BACKEND_API_URL=/backend-api`; default remains `mock`. Poll with a bounded interval and an abort signal.

- [ ] **Step 5: Integrate the store with backend mode**

Keep existing `AiAdapter` generation unchanged for Mock mode. In backend mode, build task input from only the selected outline, characters, world, previous summary, target words, and user instruction.

- [ ] **Step 6: Add the development proxy and public environment template**

Proxy `/backend-api` to configurable local FastAPI origin. Do not add provider credentials to frontend variables.

- [ ] **Step 7: Run frontend unit, type, and build checks**

Run: `npm test -- tests/unit/script-task-client.test.ts tests/unit/script-generation.test.ts tests/unit/persistence.test.ts`

Run: `npm run typecheck`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit frontend API integration**

```bash
git add src/features/script-tasks src/domain/project.ts src/stores/workflow.ts tests/unit .env.example vite.config.ts
git commit -m "feat: connect script stage to backend tasks"
```

### Task 7: Human Review and Version History UI

**Files:**
- Create: `src/components/episodes/ScriptReviewPanel.vue`
- Create: `src/components/episodes/ScriptVersionHistory.vue`
- Modify: `src/views/ScriptGenerationView.vue`
- Modify: `src/components/episodes/ScriptEditor.vue`
- Modify: `tests/unit/script-generation.test.ts`
- Modify: `tests/e2e/workflow.spec.ts`

**Interfaces:**
- Consumes: task metadata and store review actions from Task 6.
- Produces: accessible review controls for accept, edited accept, feedback revision, cancellation, quality details, retry count, and history.

- [ ] **Step 1: Add failing component tests**

Assert running stage text, quality failure details, human-review controls, feedback requirement, acceptance disabled while running, version selection, and Mock-mode compatibility.

- [ ] **Step 2: Run component tests to verify failure**

Run: `npm test -- tests/unit/script-generation.test.ts`

- [ ] **Step 3: Implement review and history components**

Keep the current workbench layout. Use existing button, status, editor, and modal patterns. Do not add a new dashboard or redesign unrelated stages.

- [ ] **Step 4: Update the stage-five view**

Show current graph stage, task status, retry count, quality dimensions, sanitized errors, and latest draft. Require explicit user approval before marking the project script confirmed.

- [ ] **Step 5: Preserve current Mock E2E flow**

Update Playwright assertions only where labels changed; Mock mode must still complete all five stages without a Python backend.

- [ ] **Step 6: Run frontend verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm run test:e2e`

Expected: all pass.

- [ ] **Step 7: Commit the review UI**

```bash
git add src/components/episodes src/views/ScriptGenerationView.vue tests
git commit -m "feat: add script quality review interface"
```

### Task 8: Documentation, Contracts, and Complete Verification

**Files:**
- Create: `backend/app/tools/__init__.py`
- Create: `backend/app/tools/contracts.py`
- Create: `backend/tests/test_tool_contracts.py`
- Modify: `README.md`
- Modify: `.gitignore`
- Modify: `package.json`
- Test: all backend and frontend suites

**Interfaces:**
- Produces typed future tool request/result/status contracts with idempotency keys and no provider implementation.
- Produces documented `dev:frontend`, `dev:backend`, and optional combined local startup commands.

- [ ] **Step 1: Write failing media-tool contract tests**

Assert idempotency key, typed status, output reference, retryability, and rejection of fake completed output without a provider result.

- [ ] **Step 2: Implement contracts without fake generators**

Define protocols for character image, scene image, storyboard, video clip, voice, and composition tools. Do not register routes or return fabricated media.

- [ ] **Step 3: Update README and environment documentation**

Document Python 3.12 setup, virtual environment creation, dependency installation, SQLite initialization, frontend and backend startup, OpenAI-compatible configuration, API examples, Mock mode, test commands, production limitations, and PostgreSQL migration direction.

- [ ] **Step 4: Add safe startup scripts**

Add npm scripts that start frontend and backend separately. Do not embed the local bundled Python absolute path in committed files.

- [ ] **Step 5: Run privacy and repository checks**

Run tracked-file scans for API key patterns, private provider domains, local Windows user paths, SQLite files, `.env.local`, and generated artifacts.

Expected: no sensitive tracked content.

- [ ] **Step 6: Run complete backend verification**

Run: `backend\.venv\Scripts\python.exe -m pytest backend/tests -v`

Run: `backend\.venv\Scripts\python.exe -m compileall backend/app`

Expected: PASS.

- [ ] **Step 7: Run complete frontend verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 8: Perform a local integration smoke test**

Start FastAPI with fake-model mode, create a script task through HTTP, poll to `awaiting_human_review`, approve it, verify `completed`, and retrieve version 1. Confirm the frontend can display and accept the same task.

- [ ] **Step 9: Commit delivery documentation**

```bash
git add backend/app/tools backend/tests/test_tool_contracts.py README.md .gitignore package.json
git commit -m "docs: finish langgraph workflow delivery"
```
