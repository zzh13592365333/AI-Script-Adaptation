# 自动 AI 漫剧流程

一个本地优先的 AI 漫剧内容生产工作台。前端保留从原稿分析到分集脚本的五阶段操作，前四阶段支持 AI 自查、人工要求修订和版本历史，脚本阶段接入 FastAPI + LangChain + LangGraph 的持久化任务后端。

## 核心能力

- 原稿导入、AI 分析、漫剧设定、全剧规划和分集大纲
- 前四阶段 AI 自查问题清单、按建议修订、人工要求重生成和版本恢复
- 严格阶段门禁：当前版本自查通过并人工确认后才解锁下一阶段
- 单集与批量脚本生成、实时状态、停止和重写
- LangGraph 结构校验、AI 质量审核和有限次数自动修订
- 人工接受、编辑后接受、反馈修订和不可变版本记录
- SQLite 任务、版本和 LangGraph 检查点持久化
- 服务重启恢复、取消、错误分类和幂等审核
- 本地项目保存、JSON 导入导出和 ZIP/TXT 导出
- 默认 Mock 模式，无需 Python、网络或 API 密钥

## 技术栈

前端使用 Vue 3、TypeScript、Vite、Pinia、Vitest 和 Playwright。后端使用 Python 3.12、FastAPI、LangChain、LangGraph、Pydantic 和 SQLite。

## Docker 交付版（推荐）

接收方只需要安装并启动 Docker Desktop，不需要单独安装 Node.js 或 Python。

### 1. 配置模型

复制根目录 `.env.example` 为 `.env`，填写 OpenAI 兼容服务：

```env
APP_PORT=8080
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_API_KEY=your-local-secret
MODEL_NAME=your-model-name
MODEL_REASONING_EFFORT=low
```

`.env` 已被 Git 和 Docker 构建上下文排除，密钥只会注入后端容器，不会进入前端文件或镜像层。

### 2. 一键启动

Windows 可以双击 `启动应用.cmd`。首次运行会自动创建 `.env` 并提示填写配置；配置完成后再次运行即可构建容器并打开：

```text
http://localhost:8080
```

也可以在终端执行：

```bash
docker compose up -d --build
```

应用仅对外开放一个 Web 端口。FastAPI 和 SQLite 不直接暴露，浏览器的 `/api` 请求由 Nginx 转发到内部后端容器。

### 3. 交付给其他用户

将整个项目目录打包，但不要包含 `.env`、`.env.local`、`backend/.env`、数据库和缓存。接收方解压后配置自己的 `.env`，再运行 `启动应用.cmd`。

局域网中的其他设备可访问 `http://运行电脑的局域网IP:8080`。部署到服务器后，可以使用 Nginx、Caddy 或云平台负载均衡器把正式域名反向代理到端口 `8080`。直接暴露到公网前应增加 HTTPS 和访问控制，因为当前版本是单机单用户工具，不包含账号系统。

### 4. 运维命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 更新代码或镜像后重建
docker compose up -d --build

# 停止但保留项目数据
docker compose stop

# 删除容器但保留项目数据
docker compose down

# 彻底删除容器和 SQLite 数据卷（不可恢复）
docker compose down -v
```

Windows 也可以双击 `停止应用.cmd` 安全停止容器。该脚本不会删除数据卷。

备份数据时，先执行 `docker compose stop`，然后运行：

```bash
docker run --rm -v automatic-ai-comic-workflow_app-data:/data -v "${PWD}:/backup" alpine tar czf /backup/app-data-backup.tar.gz -C /data .
```

Compose 项目名可能随目录名变化。先用 `docker volume ls` 确认实际卷名，再替换命令中的卷名。

## 快速体验 Mock 模式

环境要求：Node.js 20.19 或更高版本，推荐 Node.js 22.12+。

```bash
npm install
npm run dev:frontend
```

打开终端显示的地址，点击“载入示例”即可完成五阶段流程。默认配置不会启动 Python 后端，也不会消耗真实模型额度。

## 启用 LangGraph 脚本后端

### 1. 创建 Python 3.12 环境

Windows PowerShell：

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/Activate.ps1
python -m pip install -e "backend[test]"
```

macOS 或 Linux：

```bash
python3.12 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -e "backend[test]"
```

### 2. 配置后端模型

将 `backend/.env.example` 复制为 `backend/.env`，填写 OpenAI 兼容服务参数：

```env
DATABASE_PATH=backend/data/tasks.sqlite3
CHECKPOINT_PATH=backend/data/checkpoints.sqlite3
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_API_KEY=your-local-secret
MODEL_NAME=your-model-name
MODEL_REASONING_EFFORT=low
CORS_ORIGINS=["http://127.0.0.1:4173","http://localhost:4173"]
MAX_CONCURRENT_TASKS=2
MAX_INPUT_CHARS=180000
DEFAULT_MAX_RETRIES=2
```

`backend/.env` 和 `.env.local` 均被 Git 忽略。模型密钥只由 FastAPI 后端读取，不会进入浏览器请求、项目 JSON、SQLite 任务内容或 API 响应。

### 3. 启用前端后端模式

将根目录 `.env.example` 复制为 `.env.local`，至少设置：

```env
VITE_AI_ADAPTER=http
VITE_SCRIPT_WORKFLOW=backend
VITE_BACKEND_API_URL=/backend-api
BACKEND_ORIGIN=http://127.0.0.1:8000
```

`VITE_SCRIPT_WORKFLOW=backend` 将第五阶段剧本生成切换到持久化任务后端。前四阶段生成可使用 Mock 或 HTTP AI 适配器，但 AI 自查和按要求修订需要 FastAPI 后端。

### 4. 启动服务

分别启动：

```bash
npm run dev:backend
npm run dev:frontend
```

已激活 Python 虚拟环境时，也可以同时启动：

```bash
npm run dev:all
```

数据库目录和表会在 FastAPI 启动时自动创建。默认前端地址为 `http://127.0.0.1:4173`，后端地址为 `http://127.0.0.1:8000`。

## API 示例

创建脚本任务：

```bash
curl -X POST http://127.0.0.1:8000/api/script-tasks \
  -H "Content-Type: application/json" \
  -d '{
    "project_id":"project-1",
    "episode_id":"episode-1",
    "episode_number":1,
    "episode_outline":"主角在档案室发现关键证据。",
    "character_context":"主角谨慎、擅长调查。",
    "world_context":"现代都市悬疑。",
    "previous_episode_summary":"",
    "user_requirements":"结尾保留电话钩子。",
    "target_words":1200,
    "max_retries":2
  }'
```

轮询与审核：

```bash
curl http://127.0.0.1:8000/api/script-tasks/TASK_ID
curl http://127.0.0.1:8000/api/script-tasks/TASK_ID/versions
curl -X POST http://127.0.0.1:8000/api/script-tasks/TASK_ID/review \
  -H "Content-Type: application/json" \
  -d '{"action":"accept","idempotency_key":"accept-v1"}'
```

审核动作支持 `accept`、`edit_accept` 和 `request_revision`。质量不通过与模型网络故障是不同状态；达到最大自动修订次数后，任务进入人工审核，不会被标记为虚假通过。

前四阶段自查与修订：

```bash
curl -X POST http://127.0.0.1:8000/api/stage-reviews/check \
  -H "Content-Type: application/json" \
  -d '{"stage":"analysis","content":{"content":"当前分析"},"upstream_context":{"source":"原稿"}}'

curl -X POST http://127.0.0.1:8000/api/stage-reviews/revise \
  -H "Content-Type: application/json" \
  -d '{"stage":"analysis","content":{"content":"当前分析"},"upstream_context":{"source":"原稿"},"issues":["冲突不清晰"],"revision_instructions":["补充限时目标"],"user_requirements":"保留人物关系"}'
```

AI 自查只返回问题清单，不会自动消耗额外调用进行修订。用户点击“按建议修订”或提交人工修改要求后才会再次调用模型。

## 常用命令

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:all
npm test
npm run typecheck
npm run build
npm run test:e2e
python -m pytest backend/tests -q
python -m compileall backend/app
```

自动化测试使用确定性假模型，不会调用真实模型或消耗 API 配额。

## 项目结构

```text
backend/
  app/api/             FastAPI 路由
  app/models/          任务、审核和版本模型
  app/repositories/    SQLite 仓储
  app/services/        LangChain 模型层和任务服务
  app/workflows/       LangGraph 状态、校验和工作流
  app/tools/           未来媒体工具的类型合同
  tests/               后端单元与 API 测试
src/
  components/          工作台、编辑器和审核组件
  domain/              项目模型与工作流规则
  features/            AI、任务客户端、文件和持久化
  stores/              Pinia 工作流状态
  views/               五阶段页面
tests/                  前端单元与端到端测试
```

## 当前限制

- SQLite 和进程内线程池面向本地开发与单机演示，不适合多实例生产部署。
- 图片、分镜、视频、配音和合成目前只有类型合同，没有注册 API 路由，也不会返回伪造媒体。
- 生产部署应将任务执行迁移到独立工作进程，并将业务数据与 LangGraph 检查点迁移到 PostgreSQL 等共享持久层。
- 当前没有账号、租户、配额、对象存储、审计日志和生产级监控。
- Docker 交付版适合单机或受控内网使用；公网多用户部署需要额外的身份认证、HTTPS 和共享数据库架构。

## GitHub 发布检查

1. 不提交 `.env.local`、`backend/.env`、数据库或任何密钥文件。
2. 不提交 `backend/.venv/`、`dist/`、`playwright-report/`、`test-results/` 或缓存。
3. 使用 `git status --ignored` 确认本地密钥和数据库处于 ignored 状态。
4. 运行完整前后端测试、类型检查、构建和隐私扫描。

## License

当前仓库未指定开源许可证。公开发布前请根据实际使用场景补充 License 文件。
