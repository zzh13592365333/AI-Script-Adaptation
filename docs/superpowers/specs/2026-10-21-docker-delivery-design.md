# Docker 交付设计

## 目标

将“自动 AI 漫剧流程”整理为可交付给其他用户的 Docker 项目。接收方不需要安装 Node.js 或 Python，只需安装 Docker Desktop，填写模型配置并执行一键启动脚本，即可通过统一 Web 地址使用完整前后端能力。

本次交付不提供托管域名。应用对外监听单一端口，既可通过 `http://localhost:8080` 本机访问，也可在局域网或服务器上通过主机 IP、反向代理域名访问。

## 总体架构

项目包含两个运行容器：

1. `frontend`：多阶段 Docker 构建 Vue 前端，运行阶段使用 Nginx 托管静态资源。
2. `backend`：基于 Python 3.12 运行 FastAPI、LangChain 和 LangGraph。

浏览器只访问 Nginx。Nginx 将 `/api/*` 请求反向代理到 Docker 内部的 `backend:8000`，因此前端不需要知道后端容器地址，也不需要暴露后端端口。

```text
Browser -> :8080 Nginx frontend -> /api/* -> backend:8000
                                      |
                                      -> /app/data/*.sqlite3
```

## 前端构建与路由

- 前端镜像在 Node 构建阶段执行锁定依赖安装、类型检查和 Vite 生产构建。
- 生产环境统一使用相对地址 `/api`，不再依赖 Vite 开发服务器代理。
- Nginx 对 Vue History/Hash 路由提供 `index.html` 回退。
- Nginx 提供 `/health`，并代理后端 `/api/health`。
- 对外默认端口为 `8080`，可通过 Compose 环境变量修改。

## 后端运行与数据

- 后端镜像从 `backend/pyproject.toml` 安装固定版本依赖。
- 容器工作目录保持项目包结构，使用 Uvicorn 启动 `backend.app.main:app`。
- 数据库和 LangGraph 检查点统一保存到 `/app/data`。
- Compose 使用命名卷持久化 `/app/data`，重新创建容器不会丢失任务和版本历史。
- 后端不直接映射到宿主机端口，只允许前端容器通过内部网络访问。

## 配置与密钥

根目录新增 Docker 专用 `.env.example` 配置说明，接收方复制为 `.env` 后填写：

- `MODEL_BASE_URL`
- `MODEL_API_KEY`
- `MODEL_NAME`
- `MODEL_REASONING_EFFORT`
- `APP_PORT`
- 并发数、输入长度和自动重试次数

真实 `.env` 继续由 `.gitignore` 和 `.dockerignore` 排除。模型密钥只注入后端容器，不作为 Docker 构建参数，不写入前端产物、镜像层、Compose 文件或日志。

后端 CORS 允许列表不再承担公网入口控制，因为正常请求均为 Nginx 同源代理。仍保留可配置 CORS，用于开发和诊断场景。

## 启动与交付体验

提供以下入口：

- `docker compose up -d --build`：标准启动命令。
- Windows 一键启动脚本：检查 `.env` 和 Docker，构建并启动后打开浏览器。
- Windows 停止脚本：停止容器但保留数据卷。
- README：包含首次配置、启动、升级、日志、备份、停止和彻底清理说明。

启动脚本不会生成或内置任何模型密钥。缺少 `.env` 时会从示例生成本地配置文件并提示用户填写，不会继续启动真实模型模式。

## 健康检查与恢复

- 后端健康检查调用 `/api/health`。
- 前端健康检查调用 Nginx `/health`。
- 前端等待后端健康后启动或进入健康状态。
- 两个服务均使用 `restart: unless-stopped`。
- SQLite 命名卷独立于容器生命周期。

## 安全边界

- 默认只暴露前端端口，不暴露 FastAPI 和 SQLite。
- 不把当前开发机器的 `.env.local`、`backend/.env`、数据库、缓存、测试报告或 Git 元数据复制进镜像。
- Nginx 设置基础安全响应头，并限制不必要的方法与隐藏版本信息。
- 当前版本仍是单机单用户应用，不包含账号、租户、权限和公网多用户隔离。若直接暴露到公网，必须在外层反向代理增加 HTTPS 和访问控制。

## 文件改动范围

- 新增根目录 `Dockerfile.frontend`。
- 新增 `backend/Dockerfile`。
- 新增 `docker-compose.yml`。
- 新增 `deploy/nginx.conf`。
- 新增 `.dockerignore`。
- 新增 Windows 启动和停止脚本。
- 调整前端生产 API 地址默认值。
- 调整后端容器数据路径配置。
- 更新 `.env.example`、`README.md` 和相关测试。

## 验证标准

1. 前端单元测试、类型检查和生产构建通过。
2. 后端测试全部通过。
3. `docker compose config` 能解析且不包含真实密钥。
4. 两个镜像成功构建。
5. Compose 启动后，前端 `/health` 和后端代理 `/api/health` 均返回成功。
6. 页面通过 `http://localhost:8080` 打开，前端请求使用同源 `/api`。
7. 重建容器后 SQLite 数据卷仍存在。
8. 隐私扫描不包含旧品牌、真实 API 密钥或本机私有配置。

## 非目标

- 不在本次工作中购买或配置域名。
- 不部署到指定云厂商。
- 不增加账号登录、多租户、计费或生产级任务队列。
- 不把用户的真实 API 密钥打包到交付目录或 Docker 镜像。
