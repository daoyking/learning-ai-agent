# W4 · Mastra 多步编排 Agent：简历打分器

前端转 Agent 的第四个练手项目：用 **Mastra**（TS 原生 Agent 框架）搭一个
「读简历 → 抓 JD → 多维度打分 → 给改进建议」的多步 Agent。重点体会 Mastra 相对
裸写 Vercel AI SDK（W2）多出来的能力：**Agent 封装、工具、记忆、结构化输出、工作流编排**。

## 技术栈
- `@mastra/core`：Agent / Tool / Workflow
- `@ai-sdk/openai`：模型（兼容 DeepSeek / OpenAI / 通义）
- 运行：Node + `tsx`

## 运行
```bash
cp .env.example .env   # 默认已配本地 Ollama，也可换任意 OpenAI 协议兼容端点
npm install
npm start              # 用 Agent（带工具）读取简历+JD 并打分，输出 Markdown 报告
```

### 模型后端（默认走本地 Ollama）

```bash
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3:14b
```

换回云端只需改这三行（原 SiliconFlow 配置留档为 `.env.bak-siliconflow-*`）。
注意本地 14B 模型跑完整流程约 **2–3 分钟**（云端通常 20–40 秒），演示时预留时间。

### 样例数据：改造前 / 改造后

`sample/` 下放了两份简历，用来演示「用打分器自检差距」的闭环：

| 文件 | 说明 | 实测总分 |
|------|------|---------|
| `resume-v1-before.txt` | 改造前：AI 一栏只写「正在学习 Agent 开发」 | **38/50**（AI 维度仅 5/10） |
| `resume.txt`（当前） | 改造后：补上 4 个可运行 Agent 工程与具体技术点 | **45/50**（AI 维度 10/10） |

打分器读的是 `sample/resume.txt`。想复现「改造前」的分数，把它换成
`resume-v1-before.txt` 的内容即可——这个前后对比本身就是一段很好的演示叙事：
**用 Agent 找出自己简历的短板 → 按建议补 → 分数从 38 涨到 45**。

### 进阶：用 Mastra Workflow 显式编排
`workflows/scoreWorkflow.ts` 把流程拆成两个有向步骤：`loadData → score`，
比 Agent 黑盒更可控、可观测、可复用。运行方式：

```ts
import { scoreWorkflow } from './workflows/scoreWorkflow.js';

const run = await scoreWorkflow.createRun();
const res = await run.start({ inputData: {} });   // 注意是 .start()，不是 .execute()
console.log(res.result);   // 或 res.steps 查看每步输出
```

> 本项目已用 `npm start`（Agent 版）验证：Agent 与 Workflow 均能正确构造并发起模型调用
> （需有效 API Key 且网络可达 OpenAI / DeepSeek 等端点）。


## 多步编排体现在哪
1. 工具 `readResume` / `readJobDescription` 让 Agent 主动读取本地文件（演示「读简历→抓 JD」）。
2. Agent 的 `instructions` 规定打分维度（框架匹配 / 工程能力 / AI 经验 / 作品集 / 表达）。
3. 输出为结构化 Markdown 报告，可继续接 Mastra 的 `Workflow` 把「读取→打分→润色」拆成有向步骤。

## 与 W2 的区别
- W2 是裸 `streamText` + 自己写循环；W4 用 Mastra 的 `Agent` 把「模型 + 工具 + 提示」打包成可复用单元。
- 进阶：把打分拆成 `createWorkflow` 的多步流水线，并用 `Memory` 记住历史简历，做「前后对比」。

## 评测（CI 回归，来自 W5）

本工程配套评测数据集 `sample/eval-dataset.json`，用 W5 的 `runEval`（LLM-as-judge）做质量护栏：

```bash
npm test        # 离线 CI 回归（node:test + tsx，零 key）：校验数据集结构 + eval 聚合逻辑
npm run eval    # 真实 LLM 评测：跑真实 Mastra Agent（读简历→抓 JD→打分）写出 eval-report.md（需 .env 填 key）
```

`evals/agent.ts` 复用本工程真实的 `resumeScorer.generate()`，把多步编排结果包成无头 `AgentRun` 交给评测；
评测逻辑与 W5 完全一致（评测即回归）。

