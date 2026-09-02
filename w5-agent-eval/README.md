# W5 · Agent 评测与可观测

W5 练手项目：给 W2–W4 的 Agent 套上**质量护栏**——既能用「LLM-as-judge」自动打分评测，
又能用「自建 Tracer / AI SDK telemetry」把一次运行变成可观测的时间线。这是区分「玩具」与「产品」的分水岭。

## 它解决什么

- **评测（Eval）**：改了 prompt / 工具后，怎么知道 Agent 没变差？→ 用 rubric + LLM 评审员对输出自动打 0-10 分。
- **可观测（Observability）**：线上 Agent 卡住 / 乱调工具，怎么排查？→ 把每次运行的模型调用、工具调用、各阶段记成 span 时间线。

## 目录结构

```
src/
  model.ts      createOpenAI().chat() 兼容端点（DeepSeek/通义/OpenAI）
  trace.ts      零依赖自建 Tracer：span 时间线 + Markdown 报告
  tools.ts      calculator（安全四则）+ searchDocs（检索即工具）
  agent.ts      示例 Agent（streamText + telemetry 开启 + span 包裹）
  judge.ts      LLM-as-judge（generateText 抽 JSON + zod 校验打分；DeepSeek 不支持 json_schema 故不用 generateObject）
  dataset.ts    从 sample/dataset.json 加载评测用例
  runEval.ts    编排：跑 agent → 逐条 judge → 聚合 → 写报告
  demo.ts       离线演示 Tracer（无需 API key）
sample/dataset.json   评测数据集
tests/               vitest 离线单测（工具 + 评测器，不依赖 key）
```

## 运行

```bash
npm install
cp .env.example .env   # 填入 OPENAI_API_KEY / OPENAI_BASE_URL / AI_MODEL
npm run demo          # 离线演示 Tracer（无需 key）
npm test              # vitest 离线单测（无需 key）
npm run eval          # 真实 LLM 评测，写出 eval-report.md（需 key）
```

### eval 的命令行参数

```bash
npm run eval                                  # 全量（本地 14B 约 7 分钟）
npm run eval -- --case multi-1                # 只跑一个用例（约 3 分钟），改 prompt 时快速验证
npm run eval -- --case calc-1 --case rag-1    # 指定多个
npm run eval -- --out /tmp/try.md             # 报告写到别处，不覆盖 eval-report.md
npm run eval -- --no-write                    # 只打印不落盘
```

全量跑一轮要 7 分钟左右（9 次 judge + 3 次 agent，本地 14B 模型）。
调 prompt 时用 `--case` 只跑相关用例，能省一半时间。

### ⚠️ 模型必须支持 tool_calls

本工程的 Agent 靠工具调用完成任务，**模型不支持 `tool_calls` 时 eval 会全线崩塌**
（表现为「工具调用 0 次」，模型把调用写成 JSON 文本正文，而 judge 认的是真实调用记录）。

实测（Ollama OpenAI 兼容端点）：

| 模型 | tool_choice=auto | tool_choice=required |
|---|---|---|
| `qwen3:14b` | ✅ 正常返回 `tool_calls` | ✅ 正常 |
| `qwen2.5-coder:14b` | ❌ 只输出 JSON 文本 | ❌ 只输出 JSON 文本 |

换模型后先跑一次 `npm run eval -- --case calc-1` 确认工具调用正常，再跑全量。

## 关键约定（避坑）

1. AI SDK v7：`tool({ inputSchema, execute })`；`streamText` 用 `messages` 或 `prompt`；
   前端用 `useChat({ transport })`（详见 [[Vercel AI SDK]] / ts-agent-scaffold 技能）。
2. `createOpenAI().chat(model)` 走 Chat Completions，兼容 DeepSeek / 通义等。
3. `telemetry: { isEnabled: true }` 是 AI SDK 原生可观测开关；有 OpenTelemetry SDK 时导出到 collector，无 SDK 时自动 no-op。
4. 评测器与 Agent 都做成「可注入」（`runEval(judge, agent, dataset)`），离线单测用 mock，真实跑用 LLM——**改 prompt 即跑回归**。
5. **`streamText` 必须加 `stopWhen: stepCountIs(N)`**：AI SDK v5+ 默认只跑一步，模型一返回工具调用就结束，
   需要多步的任务会静默退化。本工程吃过这个亏，详见 [docs/ITERATION.md](./docs/ITERATION.md)。
6. **`.env` 的加载要放在 `model.ts` 而不是入口文件**：本工程 `npm start` 走 `index.ts`、
   `npm run eval` 走 `src/cli.ts`，是两个入口。只在入口写 `import 'dotenv/config'` 很容易漏，
   漏了之后 `AI_MODEL` 静默回落到硬编码默认值、连到错误端点，极难排查。
   放在 `model.ts` 里，任何 import 链经过它的入口都会自动加载。

## 迭代记录：eval 是怎么发现问题的

`docs/` 下留了**四轮**真实评测报告，完整过程见 [docs/ITERATION.md](./docs/ITERATION.md)：

| 轮次 | 改动 | 通过率 | 加权均分 | `synthesize` 兜底 |
|---|---|---|---|---|
| [v1 基线](./docs/eval-v1-baseline.md) | — （`.env` 未加载 + 模型不支持 `tool_calls`） | 0% | 0.47/10 | 未触发（压根没调工具） |
| [v2](./docs/eval-v2-model-fix.md) | 换用支持 `tool_calls` 的 `qwen3:14b` | 100% | 9.6/10 | **每个用例都触发** |
| [v3](./docs/eval-v3-stopwhen.md) | 补 `stopWhen: stepCountIs(5)` | 67% | 9.4/10 | 消失 ✅ |
| [v4](./docs/eval-v4-judge-fix.md) | 修 judge 判定依据（以真实调用记录为准） | **100%** | **9.67/10** | 消失 ✅ |

**v2 与 v3 分数几乎一样，但 trace 不一样** —— v2 每个用例都多出一个 `agent:synthesize`
span（模型没跑完循环，靠兜底逻辑补答案），v3/v4 没有。分数看不出这层差异，可观测能。
这正好说明为什么 eval 和 observability 必须成对出现：前者告诉你「好不好」，后者告诉你「为什么」。

四次改动里**没有一次是调 prompt**，全是配置、框架用法、评测设计层面的问题 ——
也都是「只读代码发现不了、一跑就现形」的那类。

> `eval-report.md` 是每次覆盖的最新产物（已 gitignore）；每轮归档在 `docs/eval-vN-*.md`，可追溯。

## 进阶

- 把 `tracer` 的 span 结构对接 OpenTelemetry SDK，由 OTLP 导出到 Langfuse / Jaeger，获得生产级 trace。
- 用 `promptfoo` / `deepeval` / `rai` 等框架做更大规模对比评测（同一数据集横评多个 prompt/模型）。
- 把 eval 接进 CI：每次 PR 跑 `npm test`，分数低于阈值则阻断合并。

## 接真实 Langfuse（生产可观测，已实现）

`src/langfuse.ts` 的 `LangfuseExporter` 已把自建 Tracer 的 span 树映射到 Langfuse 的 trace + 嵌套 observation
（`model:` 类 span → generation，其余 → span）。它**条件式启用**：

```bash
npm install langfuse            # 装好依赖
# .env 里配置：
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

```bash
npm run demo     # 离线演示 Tracer（无 key → 自动 no-op，不影响流程）
npm run eval     # 真实评测，trace 自动 flush 到 Langfuse（配了 key 才导出）
```

未配置 key 时 `flush()` 直接 no-op；初始化失败（如装了包却没网）自动降级为离线 trace 并打印一次告警，绝不中断评测。

## 给 W2–W4 做 CI 回归（已落地）

W5 的 `runEval` 是可复用评测内核，`w2/w3/w4` 三个工程各配了一份 `sample/eval-dataset.json`，
并通过 `evals/agent.ts`（复用各自真实工具 + 模型）接入评测：

```bash
cd w2-agent-chat && npm test && npm run eval   # 同 w3-rag-qa / w4-resume-scorer
```

- `npm test`：node:test + tsx 离线单测（零 key），校验数据集结构 + eval 聚合逻辑 → CI 门禁。
- `npm run eval`：真实 LLM 评测，写出各工程的 `eval-report.md`（需 key）。
- 这样「改了 prompt / 工具 → 跑 eval 看分数」在三个工程上都成立，评测即回归。

