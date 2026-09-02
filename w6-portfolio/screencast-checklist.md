# 录屏执行清单 + 已验证运行日志（W6 作品集交付）

> 说明：本环境无法生成 `.mp4` 录屏视频文件，因此这里交付两样东西：
> 1. **已验证运行日志**——我方实际跑通的工程证据（离线 / 零 key 可跑部分，已实测通过）；
> 2. **一键录屏脚本**——你照着录就能生成一段 3–5 分钟的作品集演示视频。
> 真实「对话 / 检索 / 打分」需要你在各工程 `.env` 填好 key 后本地运行（录屏前必做）。

---

## 一、已验证运行日志（实测证据，2026-08-09）

| 工程 | 已实测命令 | 结果 |
|---|---|---|
| w5-agent-eval | `npm run demo` | ✅ 离线 Tracer 输出 4 spans（agent:run → retrieve / tool:calculator / model:generate），累计 128ms |
| w5-agent-eval | `npm test` | ✅ 6/6 通过（vitest，离线） |
| w5-agent-eval | `tsc --noEmit` | ✅ 类型干净（含 Langfuse 接入后） |
| w2-agent-chat | `npm run build` | ✅ 117 modules，built in 270ms |
| w2-agent-chat | `npm test` | ✅ 2/2（离线 CI 回归，零 key） |
| w3-rag-qa | `npm run build` | ✅ 122 modules，built in 850ms |
| w3-rag-qa | `npm test` | ✅ 2/2（离线 CI 回归，零 key） |
| w4-resume-scorer | `tsc --noEmit` | ✅ 类型干净 |
| w4-resume-scorer | `npm test` | ✅ 2/2（离线 CI 回归，零 key） |

> 离线 CI 回归（`npm test`）全部已通过，证明「评测数据集结构 + eval 聚合逻辑」在零 key 下可跑——
> 这正是 CI 门禁要的效果：改了 prompt / 工具，PR 上 `npm test` 红就拦得住。

**真实 LLM 评测（需 key，录屏时用）**：`cd 某工程 && npm run eval` → 跑真实 Agent 并写出 `eval-report.md`；
Langfuse 接法则在 `.env` 配 `LANGFUSE_PUBLIC_KEY/SECRET_KEY` 后，`npm run eval` 的 trace 自动 flush 到 Langfuse。

### 真实模型端到端实测（本地 Ollama `qwen3:14b`，2026-09-02）

上面是离线 CI；下面是**真实模型调用**，四个工程逐个跑通：

| 工程 | 输入 | 结果 | 耗时 |
|---|---|---|---|
| w2-agent-chat | 「现在北京时间几点？」 | ✅ 调 `getCurrentTime` → 回答真实时间 | 13.4s |
| w3-rag-qa | 「什么是 RAG？」 | ✅ `retrieve` 返回 3 条片段 → 带真实文件名引用作答 | 105s |
| w4-resume-scorer | `sample/resume.txt` | ✅ 5 维度打分，总分 **45/50**（AI 维度 10/10） | 2m35s |
| w4-resume-scorer | `sample/resume-v1-before.txt` | ✅ 总分 **38/50**（AI 维度 5/10）——改造前基线 | 2m6s |
| w5-agent-eval | `npm run demo` | ✅ 离线 Tracer 4 spans | 128ms |

> W3 的 105 秒里，绝大部分是本地 14B 模型的多步生成（第一步检索 + 第二步作答）。
> 切回云端模型通常 20–40 秒，本地跑的代价就是慢。

---

## 二、录屏前准备（一次性）

**模型后端已统一切到本地 Ollama**（2026-09-02），因此不需要填任何云端 key：

```bash
# 1) 确认 Ollama 在跑 + 模型已装
curl -s http://localhost:11434/api/tags > /dev/null && echo "ollama 在跑"
ollama list   # 需要 qwen3:14b（W2/W3/W4）和 qwen2.5-coder:14b（W5）

# 2) 装依赖（首次）
for d in w2-agent-chat w3-rag-qa w4-resume-scorer w5-agent-eval; do (cd "$d" && npm install); done

# 3) 可选：接 Langfuse（W5 真实可观测）
#    在 w5-agent-eval/.env 加 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST
```

> 为什么切本地：原云端 SiliconFlow 账户余额不足（API 返回 `30001 insufficient balance`），
> 四个工程全都调不通。本地优先的好处是**演示永不受额度与断网影响**。
> 想换回云端只需改三个 `.env` 里的 `OPENAI_BASE_URL` / `AI_MODEL`，
> 原配置留档在各工程的 `.env.bak-siliconflow-*`。

**4) 开录前自检（30 秒，必做）**

```bash
cd w6-portfolio
./scripts/preflight.sh          # 秒级：连通性实测 / 模型 / 依赖 / 端口 / 作品集文件
./scripts/preflight.sh --test   # 完整：额外跑四个工程的离线 npm test（1–2 分钟）
```

自检会**真的发一次请求**探测模型端点，而不只是看「.env 里有没有 key」——
余额不足 / key 失效 / 模型名不存在这三种情况，光查配置是查不出来的（这次就栽在这）。
同时会顺手清掉 `index.html` 里被可视化编辑器注入的 `data-page-node-id`
（284 行变脏、44.7KB→64.4KB，文本内容不变，但会淹没 diff；幂等，无污染时秒退）。

录屏工具任选：macOS 自带 `Shift+Cmd+5`、OBS、或 QuickTime。

**5) 本地 14B 模型的耗时预期（务必预留）**

| 工程 | 实测耗时（`qwen3:14b`，M 系列） |
|---|---|
| W2 问时间（1 次工具调用） | ~13 秒 |
| W3 RAG（检索 + 生成两步） | ~105 秒 |
| W4 简历打分（读简历 + 读 JD + 打分） | ~2 分 35 秒 |

所以别在一屏里等它跑完——**要么先跑一遍把结果留在屏幕上再录，要么提前起好进程**。
W3/W4 建议开录前先在后台跑一次预热（模型权重进内存后第二次会快不少）。

---

## 三、逐段录屏脚本（3–5 分钟）

> 每段给出：画面（做什么）+ 口播（说什么）+ 命令 + 预期输出。建议每段单独录、最后剪接。

**① 开场（20s）**
- 画面：打开 `w6-portfolio/index.html`（作品集首页）
- 口播：「我是前端工程师，正在转型 AI Agent 应用开发。用 6 周做了 4 个可运行工程 + 评测/可观测两套质量护栏，下面演示给大家看。」
- 操作：滚动看 Hero + 路线时间线（W1–W6）

**② W2 流式聊天 + 工具（50s，实测 ~13s）**
- 命令：`cd w2-agent-chat && npm run dev` → 打开 http://localhost:5173
- 画面：输入框问「现在北京时间几点？」再问「读一下 agent-guide.md 并总结」
- 口播：「重点看工具调用的输入/输出/状态是实时可视化的——这正是前端工程师做 Agent 的护城河。」
- 预期：界面出现 `getCurrentTime` / `readFile` 工具调用卡片与流式回答
- 可讲的坑：AI SDK v5+ 默认只跑一步，不传 `stopWhen: stepCountIs(N)` 的话，
  模型一返回工具调用就结束，界面上会看到「调了工具但没回答」。

**③ W3 RAG 流式问答（50s，实测 ~105s，务必预热）**
- 命令：`cd w3-rag-qa && npm run dev` → 打开 http://localhost:5174
- 画面：问知识库里关于 RAG / 向量检索的问题
- 口播：「检索来源（文件名 + 相似度 + 片段）和引用都可视化出来，降低幻觉。
  这里 embedding 用的是本地哈希向量，零依赖、离线可跑——我会在 README 里说明这个取舍。」
- 预期：检索来源清单 + 带真实文件名的引用
- 可讲的坑：不强制检索的话，小模型常常跳过 `retrieve` 直接回答，
  来源标注就成了**幻觉**——所以第一步用 `toolChoice` 强制走检索。

**④ W4 多步编排（50s，实测 ~2m35s，务必预热）**
- 命令：`cd w4-resume-scorer && npm start`
- 画面：终端输出「读简历 → 抓 JD → 多维度打分 → 建议」的 Markdown 报告
- 口播（这段是全场最强的叙事，别省）：「这个打分器我自己也在用。
  最初我喂进去的是一份只写了『正在学习 Agent 开发』的简历，AI 维度只拿了 5/10、总分 38；
  我按它给的建议把四个 Agent 工程补上，再跑一次——45/50，AI 维度满分。
  **Agent 不只是作品，它也是我改进作品的工具。**」
- 预期：5 维度分数 + 总分 45/50 + 3 条改进建议
- 复现对比：`sample/resume-v1-before.txt`（38 分）↔ `sample/resume.txt`（45 分）

**⑤ W5 评测与可观测（60s）**
- 命令：`cd w5-agent-eval && npm test`（离线，展示 CI 绿）再 `npm run eval`（真实，出 eval-report.md）
- 画面：终端显示通过率 / 加权均分；若配了 Langfuse，打开 Langfuse 项目看 trace
- 口播：「改了 prompt 就跑 eval 看分数掉没掉；一次运行变成可观测的 span 时间线，还能导到 Langfuse。这是玩具与产品的分水岭。」
- 预期：eval-report.md 生成；Langfuse 里出现嵌套 trace

**⑥ 收尾（30s）**
- 画面：回到作品集首页「工程实践」节
- 口播：「前端的可视化能力 + Agent 的质量护栏，是我做 AI 产品的差异化优势。四个工程 + 评测 + 可观测，全部可运行、可回归。」
- 操作：结束录制

---

## 四、产出物清单（交付给招聘方）

- 作品集站点：`w6-portfolio/index.html`（可双击打开 / 部署）
- 四个工程：w2 / w3 / w4 / w5（各含 README + 评测数据集 + 离线 CI）
- 评测报告：各工程 `eval-report.md`（真实跑出）
- 可观测：Langfuse 项目里的 trace 截图（可选，配 key 后录）
- 录屏视频：你按本清单自录的 `.mp4`
