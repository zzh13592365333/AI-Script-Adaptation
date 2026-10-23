# AI 漫剧阶段自查与人工审核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为前四个文本生产阶段增加 AI 自查、人工要求修订、版本历史和严格的顺序确认门禁。

**Architecture:** FastAPI 暴露同步的阶段检查与修订接口，内部使用 LangChain 结构化输出和 LangGraph 短工作流。Vue/Pinia 保存项目级审核元数据和版本快照，统一审核组件驱动四个阶段页面，并通过现有 dirty 传播保护下游内容。

**Tech Stack:** Vue 3、TypeScript、Pinia、FastAPI、Pydantic、LangChain、LangGraph、Vitest、pytest

**Spec:** `docs/superpowers/specs/2026-10-20-stage-review-gates-design.md`

## Global Constraints

- 不删除或覆盖已有项目内容和版本。
- API 密钥仅由后端读取，响应与日志不得包含密钥。
- AI 自查不得自动修订，必须由用户触发。
- 只有当前版本自查通过后才允许确认并进入下一阶段。
- 不创建 Git 提交。

## Review Focus

- 旧项目没有 `stageReviews` 时必须无损迁移。
- 检查结果属于旧版本时不得解锁确认。
- 修订返回缺少必要字段时必须拒绝覆盖当前内容。
- 上游修改后下游内容必须保留但变为 `dirty`。
- 进行中的检查或修订不得重复提交或确认。

---

### Task 1: 后端阶段审核模型与 LangGraph

**Files:**
- Create: `backend/app/models/stage_review.py`
- Create: `backend/app/workflows/stage_review_graph.py`
- Modify: `backend/app/services/model_provider.py`
- Modify: `backend/app/services/prompts.py`
- Test: `backend/tests/test_stage_review_graph.py`

**Interfaces:**
- Produces: `StageReviewRequest`, `StageRevisionRequest`, `StageReviewResult`, `StageRevisionResult`, `build_stage_review_graph(provider)`。

- [ ] 编写失败测试，覆盖检查通过、返回问题、按建议修订和无效结构化输出。
- [ ] 运行 `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_stage_review_graph.py -q` 确认失败。
- [ ] 实现阶段模型、提示词、Provider 方法和 LangGraph 条件路由。
- [ ] 重跑测试确认通过。

### Task 2: FastAPI 阶段审核接口

**Files:**
- Create: `backend/app/api/stage_reviews.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_stage_review_api.py`

**Interfaces:**
- Produces: `POST /api/stage-reviews/check`、`POST /api/stage-reviews/revise`。

- [ ] 编写接口契约与错误映射失败测试。
- [ ] 运行目标测试确认失败。
- [ ] 注册路由并调用共享 LangGraph 服务。
- [ ] 重跑目标测试确认通过。

### Task 3: 前端审核状态、版本和门禁

**Files:**
- Modify: `src/domain/project.ts`
- Modify: `src/domain/workflow.ts`
- Modify: `src/features/project/persistence.ts`
- Test: `tests/unit/workflow.test.ts`
- Test: `tests/unit/persistence.test.ts`

**Interfaces:**
- Produces: `StageReviewState`、版本快照、`canConfirmStage()`、审核失效和下游 dirty 传播。

- [ ] 编写失败测试，覆盖自查版本匹配、修订失效、恢复失效和旧项目迁移。
- [ ] 运行目标测试确认失败。
- [ ] 实现最小数据模型和纯函数。
- [ ] 重跑目标测试确认通过。

### Task 4: 前端 API 客户端与 Store 操作

**Files:**
- Create: `src/features/stage-reviews/types.ts`
- Create: `src/features/stage-reviews/client.ts`
- Modify: `src/stores/workflow.ts`
- Test: `tests/unit/stage-review-client.test.ts`
- Test: `tests/unit/workflow-store.test.ts`

**Interfaces:**
- Produces: `checkStage(stage)`、`reviseStage(stage, feedback)`、`restoreStageVersion(stage, version)`。

- [ ] 编写客户端契约和 Store 状态转换失败测试。
- [ ] 运行目标测试确认失败。
- [ ] 实现 API 客户端、轮次防重复、版本保存与内容应用。
- [ ] 重跑目标测试确认通过。

### Task 5: 共用审核 UI 与四阶段接入

**Files:**
- Create: `src/components/review/StageReviewPanel.vue`
- Create: `src/components/review/StageVersionHistory.vue`
- Modify: `src/views/SourceAnalysisView.vue`
- Modify: `src/views/AdaptationSetupView.vue`
- Modify: `src/views/SeriesPlanningView.vue`
- Modify: `src/views/EpisodeOutlinesView.vue`
- Modify: `src/styles/base.css`
- Test: `tests/unit/stage-review-ui.test.ts`

**Interfaces:**
- Consumes: Task 4 Store 操作。
- Produces: AI 自查、人工审查、按建议修订、版本恢复和确认门禁界面。

- [ ] 编写四阶段共同行为失败测试。
- [ ] 运行目标测试确认失败。
- [ ] 实现共用组件并接入页面。
- [ ] 重跑目标测试确认通过。

### Task 6: 集成验证与文档

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/workflow.spec.ts`

- [ ] 增加严格阶段门禁 E2E 场景。
- [ ] 运行后端全部测试。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run build`。
- [ ] 重启前后端并验证健康检查与浏览器页面。
- [ ] 更新 README 的操作流程和接口说明。
