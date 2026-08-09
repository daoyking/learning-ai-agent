# Agent Starter · TS Agent 通用启动器

用 `ts-agent-scaffold` skill 从零生成的**最小可运行 Agent 工程**，作为以后任何
TS Agent 项目的起点模板。严格遵循 AI SDK v7 的已验证写法（零踩坑）。

## 技术栈
- 后端：Express + `ai` (`streamText`) + `@ai-sdk/openai`（`.chat()` 兼容 DeepSeek/通义）
- 前端：Vite + React + `@ai-sdk/react` (`useChat` + `DefaultChatTransport`)
- 流式协议：AI SDK UI Message Stream

## 运行
```bash
cp .env.example .env   # 填 key
npm install
npm run dev            # 后端 3005 + 前端 5175
```
打开 http://localhost:5175

## 内置工具（skill 脚手架默认）
- `getCurrentTime`：当前北京时间
- `calculator`：安全算术计算

## 验证记录
- `npx tsc --noEmit` 通过（前端 `src` 已被类型检查覆盖）
- `npm run build` 通过
- 注：本工程由 `ts-agent-scaffold` skill 生成，验证「照 skill 模板一遍零踩坑」。

## 扩展方向
- 加真实工具：`readFile` / `fetchUrl`（见 `w2-agent-chat`）
- 改 RAG：见 `w3-rag-qa`
- 多步编排：见 `w4-resume-scorer`（Mastra）
