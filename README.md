# 自动 AI 漫剧流程

一个可本地运行的 AI 漫剧内容生产工作台。项目将原稿到分集脚本拆成五个连续阶段，并支持 Mock AI 演示和 OpenAI 兼容接口接入。

## 功能

- 原稿导入与 AI 分析
- 漫剧创作设定
- 全剧规划与集数调整
- 分集大纲生成、编辑、确认和批量确认
- 逐集脚本生成、实时流式输出、继续生成和重写
- 阶段确认与自动跳转
- 本地项目保存、导入、导出
- 可编辑的提示词模板
- 桌面端、平板和移动端布局

## 技术栈

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Router
- Vitest
- Playwright
- Lucide Vue

## 快速开始

环境要求：Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

打开终端中显示的本地地址，点击“载入示例”即可体验完整流程。默认使用本地 Mock AI，不需要账号、密钥或后端服务。

## 环境配置

`.env.example` 是公开模板，不包含任何真实密钥。需要本地配置时，复制为 `.env.local`：

```bash
copy .env.example .env.local
```

默认配置：

```env
VITE_AI_ADAPTER=mock
VITE_API_BASE_URL=/api
```

如需接入 OpenAI 兼容服务，将 `VITE_AI_ADAPTER` 改为 `http`，并在 `.env.local` 中填写你自己的服务端配置：

```env
VITE_AI_ADAPTER=http
VITE_API_BASE_URL=/api
OPENAI_BASE_URL=https://your-provider.example/v1
OPENAI_MODEL=your-model-name
OPENAI_REASONING_EFFORT=low
OPENAI_API_KEY=your-local-secret
```

服务端代理位于 `server/openai-proxy.ts`，密钥只在服务端读取，不会写入前端代码。`.env.local` 已被 `.gitignore` 忽略，禁止将它提交到 GitHub。

## 常用命令

```bash
# 启动开发服务
npm run dev

# 运行单元测试
npm test

# 类型检查
npm run typecheck

# 构建生产版本
npm run build

# 运行端到端测试
npm run test:e2e
```

端到端测试使用独立端口和 Mock AI，不会读取或消耗本地真实 API 配额。

## 项目结构

```text
src/
  components/       通用组件、布局和编辑器
  domain/           项目模型与工作流规则
  features/         AI 适配、提示词、文件解析和项目持久化
  stores/           Pinia 工作流状态
  views/            五个阶段页面
server/             本地 OpenAI 兼容接口代理
tests/              单元测试与端到端测试
```

## AI 适配层

页面和状态管理只依赖 `AiAdapter` 接口。当前提供两种实现：

- `MockAiAdapter`：本地演示，不需要网络和密钥。
- `HttpAiAdapter`：调用本地服务端代理，适配 OpenAI 兼容的聊天接口。

提示词模板位于 `src/features/prompts/templates.ts`，也可以在应用内通过“提示词设置”进行编辑。浏览器中的提示词设置只保存在当前浏览器本地。

## 数据与隐私说明

- 示例原稿和 Mock AI 输出使用通用虚构内容，不需要放入真实业务资料即可演示完整流程。
- 项目内容与提示词设置默认保存在当前浏览器的本地存储中，不会因 GitHub 发布而自动上传。
- 如果启用 HTTP AI 适配器，原稿片段、提示词及相关上下文会发送到你在本地配置的模型服务；请先确认服务提供方的数据处理政策，并避免发送不应外传的内容。
- 不要将真实原稿、导出的项目文件、`.env.local`、访问令牌或浏览器配置文件提交到仓库。

## GitHub 发布检查

上传前确认：

1. 不要提交 `.env.local` 或任何包含密钥的文件。
2. 不要提交 `work/`、`outputs/`、`dist/`、`test-results/` 等本地产物。
3. 用 `git status --ignored` 检查敏感文件是否处于 ignored 状态。
4. 用 `npm test`、`npm run typecheck` 和 `npm run build` 做发布前验证。

## License

当前仓库未指定开源许可证。公开发布前，请根据你的使用场景补充合适的 License 文件。
