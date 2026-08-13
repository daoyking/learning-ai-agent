# W2 · Vercel AI SDK 流式聊天 + 工具调用

前端转 Agent 的第二个练手项目：用 **Vercel AI SDK** 搭一个流式聊天界面，
并让模型能**主动调用工具**（时间 / 计算 / 天气），前端把工具调用过程实时可视化。

## 技术栈
- 后端：Express + `ai` (`streamText`) + `@ai-sdk/openai`（OpenAI 协议兼容）
- 前端：Vite + React + `@ai-sdk/react` (`useChat`)
- 流式协议：AI SDK UI Message Stream（文本增量 + 工具调用事件）

## 运行
```bash
cp .env.example .env   # 填入 API key（DeepSeek / OpenAI 等）
npm install
npm run dev            # 同时起后端(3001) 与前端(5173)
```
打开 http://localhost:5173

## 内置工具
| 工具 | 说明 | 是否需外部 key |
|------|------|----------------|
| `getCurrentTime` | 获取当前北京时间 | 否 |
| `calculator` | 安全算术计算（仅数字与 + - * / ( )） | 否 |
| `getWeather` | **真实天气**（Open-Meteo，免费无需 key，支持中/英/拼音城市名） | 否 |
| `readFile` | **真实读取** `server/docs/` 下文档（含路径穿越防护） | 否 |
| `fetchUrl` | **真实抓取**网页正文（Node 全局 fetch，去标签截断） | 否 |

> 试试：「读一下 agent-guide.md 并总结」「抓取 https://example.com 的标题」「北京现在天气怎么样」——可在界面看到工具调用的完整可视化。

## 这个工程教什么
1. **Agent 循环的最小骨架**：LLM 返回的是「工具调用」还是「文本」由 SDK 自动处理。
2. **工具定义**：`tool({ description, inputSchema(zod), execute })` —— 描述决定模型何时调。
3. **真实工具的工程细节**：文件读写的沙箱化与路径穿越防护、HTTP 抓取的容错与截断。
4. **流式 UI**：`useChat` 自动消费 SSE，逐字渲染；`message.parts` 里 `tool-*` 片段即工具事件。
5. **前端差异化**：工具调用的「输入/输出/状态」可视化，正是前端工程师做 Agent 的护城河。

## 下一步
- 增删 `server/tools.ts` 里的工具（如接真实天气 API、查数据库）。
- 把 `system` 提示词改成你的领域助手。
- 进阶见 W4：用 Mastra 做多步编排 Agent。

## 评测（CI 回归，来自 W5）

本工程配套一份评测数据集 `sample/eval-dataset.json`，并用 W5 的 `runEval`（LLM-as-judge）做质量护栏：

```bash
npm test        # 离线 CI 回归（node:test + tsx，零 key）：校验数据集结构 + eval 聚合逻辑
npm run eval    # 真实 LLM 评测：跑真实 Agent 并写出 eval-report.md（需 .env 填 key）
```

`evals/agent.ts` 复用本工程真实的 `tools` + `createModel()`，把对话跑成无头 `AgentRun` 交给评测；
`evals/run.ts` 调用 W5 的 `runEval(llmJudge, agent, dataset)`，评分逻辑与 W5 完全一致（评测即回归）。


## 长期记忆（agentmemory）

本项目接入了 [agentmemory](https://github.com/rohitg00/agentmemory) 作为长期记忆服务：
- 每次对话前，用最后一条用户消息召回相关历史记忆，注入 system prompt；
- 对话结束后，把本轮对话自动存入记忆（本地向量化，免费，无需额外 key）；
- 记忆数据存于项目内 `data/` 目录（已 gitignore），可整个目录删掉重置。

### 启动方式（两个终端）

```bash
# 终端 1：先启动记忆服务（端口 3111，实时查看器 3113）
npm run memory:start

# 终端 2：再启动项目
npm run dev
```

验证记忆服务是否就绪：`curl http://localhost:3111/agentmemory/health`。
服务未启动时聊天功能不受影响（记忆部分自动跳过）。
