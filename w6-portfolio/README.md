# W6 · Agent 应用开发作品集交付

前端转 AI Agent 应用开发的收尾周：把 **W2 流式聊天 / W3 RAG / W4 多步编排 / W5 评测可观测**
整合为一个统一、可演示、可投递的作品集，并配套录屏脚本与面试讲解要点。

> 本目录是一个**自包含的作品集站点**（`index.html`，无构建、无外部依赖，双击即可在浏览器打开），
> 它引用同级目录里的四个真实工程作为「作品」。本 README 说明怎么跑通每个工程、怎么跑评测、怎么接可观测，以及怎么录屏讲解。

## 线上地址（可直接投递 / 分享）

| 页面 | 地址 |
|------|------|
| 作品集 | https://daoyking.github.io/learning-ai-agent/ |
| 简历页 | https://daoyking.github.io/learning-ai-agent/resume.html |
| 仓库 | https://github.com/daoyking/learning-ai-agent |

站点由 GitHub Pages 托管，源分支 `gh-pages`（站点的 `index.html` / `resume.html` 需与 `main` 上的
`w6-portfolio/` 保持同步，Pages 不会自动跟随 `main` 更新——改完记得两边都推）。

**简历页用法**：浏览器打开后 `⌘P` / `Ctrl+P` 打印 → 存为 PDF，即 A4 两页定稿版。
页面顶部「返回作品集 / 下载 HTML / 打印提示」三栏在打印时自动隐藏，不会出现在 PDF 里。

## 目录结构

```
learning-AI/
├── w6-portfolio/        ← 本目录（作品集站点 + 说明）
│   ├── index.html       自包含作品集页面（导航 / 路线 / 作品 / 工程实践 / 录屏）
│   ├── resume.html      简历页（A4 两页定稿，含 AI 能力章节；屏幕显示带纸张容器）
│   ├── screencast-checklist.md  录屏执行清单（逐段画面 + 口播 + 命令）
│   ├── scripts/
│   │   ├── preflight.sh       录屏前一键自检（env / 依赖 / 端口 / 测试）
│   │   ├── strip-node-ids.sh  清理可视化编辑器注入的 data-page-node-id 污染
│   │   └── gen-eval-report.ts 评测报告生成
│   └── README.md        你正在看的文件
├── w2-agent-chat/       流式聊天 + 工具调用（Express + React + AI SDK）
├── w3-rag-qa/           RAG 流式问答（Embedding + 内存向量库）
├── w4-resume-scorer/    Mastra 多步编排（简历打分器）
└── w5-agent-eval/       Agent 评测 + 可观测（LLM-as-judge + Tracer）
```

## 本地预览作品集

直接双击 `index.html`，或在目录下起一个静态服务：

```bash
cd w6-portfolio
python3 -m http.server 4173      # 打开 http://localhost:4173
```

页面内的「作品」卡片链接指向同级工程的 `README.md`，本地打开即可串起整条故事线。

## 逐个跑通工程（演示前必做）

所有工程都需要一个 `.env`（复制 `.env.example`）。聊天/RAG/编排默认走 OpenAI 协议兼容端点，
可用 DeepSeek / 通义 / OpenAI key。

| 工程 | 运行 | 演示看点 |
|------|------|----------|
| `w2-agent-chat` | `npm install && npm run dev` → http://localhost:5173 | 工具调用（读文件/天气/抓取）实时可视化 |
| `w3-rag-qa` | `npm install && npm run dev` → http://localhost:5174 | 检索来源（文件名+相似度+片段）+ 引用 |
| `w4-resume-scorer` | `npm install && npm start` | 读简历→抓 JD→多维度打分→建议（结构化报告） |
| `w5-agent-eval` | `npm install && npm test` / `npm run eval` | 离线单测 + 真实评测出 `eval-report.md` |

> W3 的 Embedding 默认用 OpenAI `text-embedding-3-small`；DeepSeek 不提供 embedding，用 DeepSeek 聊天时需另配 embedding key。

## 评测怎么跑（W5 嫁接到作品上）

```bash
cd w5-agent-eval
npm test          # vitest 离线单测（工具 + 评测器，无需 key）✅ 零依赖可跑
npm run demo       # 离线演示自建 Tracer（无需 key）
npm run eval       # 真实 LLM 评测，写出 eval-report.md（需 key）
```

`runEval(judge, agent, dataset)` 支持**依赖注入**：把 `agent` / `judge` 换成 mock，
就能在不依赖 API key 的情况下单测「评分聚合 / 通过率 / span 记录」逻辑。这是把评测接进 CI 的关键。

数据集格式（`sample/dataset.json`）：

```json
{ "id": "calc-1", "input": "12*(3+4) 是多少？",
  "criteria": [{ "name": "调用了计算工具", "weight": 0.4 },
               { "name": "结果等于 84", "weight": 0.4 },
               { "name": "有简短解释", "weight": 0.2 }] }
```

把前三个作品各自的「典型问题 + 评判标准」补进数据集，就能对它们做回归评测。

## 可观测怎么接（W5 自建 Tracer / AI SDK telemetry）

- **离线即可跑**：`src/trace.ts` 的零依赖 `Tracer` 提供 `span()/event()/report()`，
  把一次运行记成嵌套 span 树并导出 Markdown 时间线，无需任何 SDK。
- **对接标准**：在 `streamText` 上开 `telemetry: { isEnabled: true, functionId }`，
  AI SDK 走原生 OpenTelemetry；配合 OTel SDK + OTLP exporter 即可把 span 发到
  **Langfuse / LangSmith / Jaeger**。
- **注意（AI SDK v7 坑）**：原生 `telemetry` 选项**不支持 `metadata` 字段**，
  自定义上下文请用自建 Tracer 的 `event()` / span attributes 承载。

## 录屏脚本（3–5 分钟）

**开录前先跑自检**（30 秒，检查四个工程的 key / 依赖 / 端口，并自动清掉 HTML 里的编辑器污染）：

```bash
cd w6-portfolio
./scripts/preflight.sh            # 快速检查
./scripts/preflight.sh --test     # 完整检查，额外跑四个工程的离线 npm test
```

阻塞项为 0 才开录；有 `✗` 就按脚本提示修（缺 `.env` / 缺依赖 / 端口被旧进程占）。
另需确认：W5 走本地 Ollama，需要 `ollama serve` 在跑且已拉 `qwen2.5-coder:14b`
（`ollama list` 核对）。

见 `index.html` →「演示」一节，或按此顺序：

1. **开场（20s）**：前端工程师转型 AI Agent，6 周 4 个工程 + 质量护栏。
2. **W2（50s）**：`cd w2-agent-chat && npm run dev`，演示「读 agent-guide.md 并总结」「北京天气」，强调工具调用可视化。
3. **W3（50s）**：`cd w3-rag-qa && npm run dev`，提问知识库，展示检索来源与引用。
4. **W4（50s）**：`cd w4-resume-scorer && npm start`，展示多步编排与结构化报告。
5. **W5（60s）**：`cd w5-agent-eval && npm test` + `npm run eval`，讲 Span 时间线与 OTel 对接。
6. **收尾（30s）**：前端可视化能力 + Agent 质量护栏 = 差异化优势。

## 面试讲解要点（差异化）

- **前端护城河**：工具调用的输入/输出/状态、检索来源与引用，都是「前端可视化」能放大的地方——纯算法背景的人容易忽略。
- **工程化思维**：不只会「调通」，还会给 Agent 写 eval、接 observability，知道玩具与产品的差距。
- **迁移能力**：React / TS / 工程化经验直接复用到 Agent 应用（流式 UI、类型安全、CI、可观测）。
- **框架取舍**：裸写 Vercel AI SDK（W2）vs 用 Mastra 编排（W4）的取舍——简单 Agent 用 SDK，多步可控用框架。

## 下一步（可选增强）

- 把四个工程收进一个 **monorepo**（pnpm workspace），统一依赖与 lint。
- ~~部署本作品集到静态托管，生成可分享链接~~ ✅ 已落地：GitHub Pages，见上文「线上地址」。

## 已落地：评测数据集 + 可观测（W6 收尾补完）

- **W2–W4 各配一份评测数据集**（`sample/eval-dataset.json`）+ `evals/agent.ts`（复用各自真实工具/模型）+
  `tests/eval.test.ts`（node:test + tsx 离线 CI 回归，零 key）+ `evals/run.ts`（真实 LLM 评测出各工程 `eval-report.md`）。
  跑法：`cd w2-agent-chat && npm test && npm run eval`（w3 / w4 同理）。
- **W5 接可观测**：`src/langfuse.ts` 的 `LangfuseExporter` 把自建 Tracer 的 span 树映射到 Langfuse
  trace + 嵌套 observation，**条件式启用**（配 `LANGFUSE_PUBLIC_KEY/SECRET_KEY` 才导出，否则 no-op）。
  离线 `npm run demo` / `npm test` 不受影响。
- **作品集已含真实评测证据**：`eval-report.md` 是 W5 在 DeepSeek `deepseek-chat` 上实跑结果
  （通过率 100%、加权均分 9.8/10），Trace 时间线也取自同一次实跑（6 个 span）。详见 `index.html` 的「质量护栏」节。
