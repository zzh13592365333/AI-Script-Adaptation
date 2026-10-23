# LangChain + LangGraph Backend Design

## Goal

Upgrade the existing Vue AI comic workflow with an independent Python backend while preserving the current UI, project schema, local import/export, prompt editing, and stages one through four. The first migration target is the per-episode script workflow.

The first release must provide a complete, testable loop for script generation, structural validation, quality review, bounded automatic revision, human review, cancellation, persistence, recovery, and version history.

## Existing System

The current application is a Vue 3, TypeScript, Vite, Pinia single-page application. AI calls are abstracted by `AiAdapter`, with a mock adapter and an HTTP adapter. The HTTP adapter calls a Vite development-server proxy that forwards OpenAI-compatible chat and streaming requests.

Workflow orchestration currently lives in the Pinia store. Project content is stored in browser `localStorage`. Outline jobs exist only in browser memory. There is no independent backend, database, durable task state, server-side workflow engine, or version history.

## Scope

### Included

- Independent FastAPI application under `backend/`.
- Pydantic request, response, task, review, and version models.
- OpenAI-compatible model configuration read only by the backend.
- LangChain-based model adapter and structured output handling.
- LangGraph workflow for episode script generation.
- Structural validation and independent quality review.
- Bounded revision loop with explicit retry limits.
- Human review interruption and resume behavior.
- SQLite development persistence for tasks, versions, and checkpoints.
- REST endpoints for health, task creation, status, result, review, regeneration, cancellation, and versions.
- Frontend API client and stage-five integration.
- Mock model implementations for tests without real API usage.
- Backend and frontend documentation and startup commands.

### Deferred

- Migration of source analysis, adaptation setup, series planning, and outline generation to LangGraph.
- Production PostgreSQL deployment.
- Redis, Celery, or another distributed task queue.
- Real image, video, voice, subtitle, or composition providers.
- Authentication, accounts, billing, or multi-user authorization.

## Architecture

```text
Vue application
  -> REST polling
FastAPI application
  -> task service
  -> LangGraph script workflow
  -> LangChain model adapter
  -> SQLite repositories and checkpoint storage
  -> OpenAI-compatible model provider
```

The frontend remains responsible for project editing and local project persistence. The backend owns AI task execution, durable task state, quality results, review state, and generated-script versions.

## Backend Modules

```text
backend/
  app/
    api/
      health.py
      script_tasks.py
    core/
      config.py
      logging.py
    models/
      script_task.py
      review.py
    repositories/
      database.py
      task_repository.py
      version_repository.py
    services/
      model_provider.py
      task_service.py
    workflows/
      script_graph.py
      state.py
      nodes/
        generate_script.py
        validate_structure.py
        review_quality.py
        revise_script.py
    tools/
      contracts.py
    main.py
  tests/
  pyproject.toml
  .env.example
```

Modules may be combined where separation would add ceremony without useful isolation, but API, workflow, persistence, and model-provider responsibilities must remain independently testable.

## Script Task Model

The backend task model contains:

- `task_id`
- `project_id`
- `episode_id`
- `episode_number`
- `episode_outline`
- `character_context`
- `world_context`
- `previous_episode_summary`
- `user_requirements`
- `target_words`
- `script_content`
- `review_feedback`
- `quality_check_result`
- `retry_count`
- `max_retries`
- `task_status`
- `current_stage`
- `final_approved`
- `version`
- `error_code`
- `error_message`
- `created_at`
- `updated_at`

Large contexts are accepted only at task creation. Workflow nodes receive the minimum state needed for their responsibility. API keys and provider configuration are never part of workflow state.

## Task Statuses

- `queued`
- `running`
- `quality_failed`
- `awaiting_human_review`
- `completed`
- `model_failed`
- `validation_failed`
- `cancelled`

`completed` means a human-approved final version, not merely that model execution ended. A quality-approved generated draft enters `awaiting_human_review` until the user accepts it.

## LangGraph Flow

```text
start
  -> generate_script
  -> validate_structure
  -> review_quality
  -> route_quality_result

route_quality_result:
  pass -> persist_draft -> interrupt_for_human_review
  fail and retries remain -> revise_script -> validate_structure
  fail and retry limit reached -> persist_draft -> interrupt_for_human_review
  technical failure -> persist_error -> end
  cancelled -> persist_cancelled -> end

human review:
  accept -> persist_approved_version -> completed
  edit and accept -> persist_user_version -> completed
  request revision -> revise_script -> validate_structure
```

Automatic revision is limited by `max_retries`. Reaching the limit never changes a failed quality result into success.

## Validation and Quality Review

Structural validation is deterministic where possible and checks required sections, non-empty content, scene headings, cast declarations, dialogue formatting, target length tolerance, and parseable structured review output.

Quality review uses a separate model call and returns structured fields:

- `passed`
- `outline_consistency`
- `character_consistency`
- `continuity_consistency`
- `format_compliance`
- `translation_compliance`
- `terminology_consistency`
- `length_compliance`
- `issues`
- `revision_instructions`

Model review is advisory. Deterministic validation failures cannot be overridden by a model claiming the script is valid.

The bilingual dialogue requirement applies to Chinese dialogue and OS lines. The script prompt and validator will require an adjacent English translation for each applicable line.

## Persistence

Development mode uses SQLite. Business tables store tasks and immutable script versions. LangGraph checkpoints use a persistent SQLite-backed checkpointer where supported by the pinned dependency version.

The database is not committed. Its location is configured by environment variable and ignored by Git.

Task creation, version writes, and review transitions are transactional. Version rows are immutable. Resume logic checks completed node state and persisted versions before invoking expensive model operations again.

SQLite is documented as development persistence, not a production multi-instance solution. PostgreSQL is the production migration target.

## Asynchronous Execution

Creating a task returns immediately with a task ID. The application executes the workflow outside the request lifecycle. The initial implementation uses an in-process bounded executor suitable for local development.

The task repository remains the source of truth, so the execution mechanism can later be replaced by a distributed queue without changing the frontend contract.

Concurrency and input length are bounded through configuration. Cancellation sets a persistent cancellation flag checked between workflow nodes and before model calls.

## API

- `GET /api/health`
- `POST /api/script-tasks`
- `GET /api/script-tasks/{task_id}`
- `GET /api/script-tasks/{task_id}/result`
- `GET /api/script-tasks/{task_id}/versions`
- `POST /api/script-tasks/{task_id}/review`
- `POST /api/script-tasks/{task_id}/regenerate`
- `POST /api/script-tasks/{task_id}/cancel`

Task responses expose status, current stage, progress, retry count, quality result, latest draft, review requirement, and sanitized error information. They never expose provider credentials or raw provider responses.

The first frontend integration uses polling because it is simpler to recover after refresh and fits the existing interaction model. SSE can be added later without changing task semantics.

## Frontend Integration

`AiAdapter` remains the boundary used by views and the Pinia store. Stage-five methods are backed by the new task API:

- Create a task for generation or rewrite.
- Poll task status and update visible progress.
- Display the latest persisted draft.
- Preserve partial or failed content.
- Submit accept, edited accept, or revision feedback.
- Cancel a running task.
- Load version history.

Stages one through four continue using the existing adapters during the first migration. Existing project JSON remains schema version 1. Backend task identifiers may be stored as optional runtime metadata, but imported legacy projects remain valid.

## Tool Extension Contracts

The backend defines typed contracts, but no fake provider implementation, for:

- character image generation
- scene image generation
- storyboard image generation
- video clip generation
- voice generation
- video composition

Each future tool contract includes an idempotency key, typed input, task status, typed output reference, retryability classification, and sanitized error information.

## Security

- Provider secrets are read from backend environment variables only.
- Secrets are never returned in API responses or logged.
- Logs contain task IDs and error categories, not full scripts or contexts.
- Request lengths, retry counts, concurrency, and timeouts are bounded.
- CORS defaults to the local frontend origin and is configurable.
- SQLite files, backend `.env`, generated media, and task artifacts are ignored by Git.
- Model and user data are validated before persistence and before model calls.

## Testing

Backend tests use deterministic fake models and cover:

- health endpoint
- task creation and API validation
- successful generation and quality pass
- quality failure followed by revision
- retry exhaustion leading to human review
- invalid model output
- provider failure
- cancellation
- human accept, edited accept, and requested revision
- task recovery and version history
- frontend/backend response contract

Existing frontend unit, typecheck, build, and Playwright suites remain required. No automated test depends on a real provider key.

## Delivery Sequence

1. Preserve the current frontend test baseline.
2. Add backend packaging, configuration, models, database, and health endpoint.
3. Add LangChain model abstraction and deterministic test model.
4. Add LangGraph generation, validation, review, and bounded revision workflow.
5. Add durable task APIs, review transitions, recovery, and version history.
6. Integrate the frontend stage-five workflow through a unified API client.
7. Add documentation, startup scripts, contract tests, and complete verification.

## Known First-Release Limitations

- In-process execution is intended for one local backend instance.
- SQLite is not the production multi-instance database.
- Only episode script generation uses LangGraph initially.
- Progress is task-stage based rather than token-level streaming.
- Media tools are contracts only and do not claim to generate real assets.
