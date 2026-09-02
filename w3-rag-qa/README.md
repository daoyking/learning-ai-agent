# W3 · RAG 流式问答站

前端转 Agent 的第三个练手项目：**检索增强生成（RAG）**。把「检索」封装成一个工具，
模型自主调用 `retrieve` 从本地知识库取回相关片段，再带引用流式作答。前端把
检索来源（文件名 + 相似度 + 片段）实时可视化——这正是前端工程师做 AI 产品的护城河。

## 技术栈
- 后端：Express + `ai`（`streamText` + `stepCountIs`）+ `@ai-sdk/openai`
- 前端：Vite + React + `@ai-sdk/react`（`useChat`）
- 检索：纯内存向量库（分块 → **本地零依赖哈希向量** → 余弦相似度 topK），零外部向量库依赖
- 流式协议：AI SDK UI Message Stream

## 运行
```bash
cp .env.example .env   # 默认已配本地 Ollama，也可换任意 OpenAI 协议兼容端点
npm install
npm run dev            # 同时起后端(3002) 与前端(5174)
```
打开 http://localhost:5174

### 模型后端（默认走本地 Ollama）

`.env` 默认指向本地 Ollama，零成本、离线可用，演示不怕断网 / 不怕余额不足：

```bash
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3:14b
```

换回云端只需改这三行（原配置留档为 `.env.bak-siliconflow-*`）。

### Embedding 的真实实现（重要）

`server/embed.ts` 用的是**本地零依赖哈希向量**（词频统计 → 512 维 → L2 归一化），
**不调用任何外部 embedding API**。这是个有意的取舍：

| | 本地哈希向量（当前） | 语义 embedding（bge-m3 等） |
|---|---|---|
| 依赖 | 零，离线可跑 | 需 key、需联网、可能要钱 |
| 语义匹配 | 弱，主要靠词面重合 | 强，同义改写也能命中 |
| 演示稳定性 | 高 | 受限于额度与网络 |

因此 `.env` 里的 `AI_EMBEDDING_MODEL` **当前未被代码读取**——留着是为了后续切换。
若你要接真实语义 embedding：

- SiliconFlow 上可用的模型是 `BAAI/bge-m3`；
- **不要填 `text-embedding-3-small`**——那是 OpenAI 的模型名，在 SiliconFlow 会报
  `Model does not exist`（2026-09-02 实测踩过这个坑）。

## 这个工程教什么
1. **RAG 三阶段**：Ingest（分块+向量化）→ Retrieve（余弦相似度）→ Generate（带引用生成）。
2. **检索即工具**：把 `retrieve` 做成 tool，复用 Agent 循环，无需单独编排检索链。
3. **向量化的成本权衡**：词频哈希向量 vs 语义 embedding，什么时候值得为语义匹配付费/加依赖。
4. **多步循环必须显式声明**：AI SDK v5+ 的 `streamText` 默认**只跑一步**——
   模型返回工具调用后就停了，答案会是空的。必须传 `stopWhen: stepCountIs(N)`
   才会有「调工具 → 拿结果 → 再生成」的第二步。
5. **强制检索而非听模型的**：`toolChoice: { type: 'tool', toolName: 'retrieve' }`
   保证第一步一定走检索，否则小模型常常跳过检索直接回答，来源标注也就成了幻觉。
6. **前端差异化**：检索来源清单（文件名/相似度/片段）与抓取来源（URL）的可视化，是作品集亮点。

## 下一步
- 把本地哈希向量换成 `BAAI/bge-m3` 等语义 embedding（对照上面的取舍表）。
- 把内存向量库换成 Chroma / pgvector / Qdrant（生产级）。
- 加 re-rank 精排、引用高亮、混合检索（BM25 + 向量）。
- 进阶见 W5：评测（eval）与可观测性（LangSmith / 自建 trace）。

## 评测（CI 回归，来自 W5）

本工程配套评测数据集 `sample/eval-dataset.json`，用 W5 的 `runEval`（LLM-as-judge）做质量护栏：

```bash
npm test        # 离线 CI 回归（node:test + tsx，零 key）：校验数据集结构 + eval 聚合逻辑
npm run eval    # 真实 LLM 评测：先 ingest() 索引知识库，再跑真实 Agent 写出 eval-report.md（需 .env 填 key）
```

`evals/agent.ts` 复用本工程真实的 `ingest()` + `tools`（retrieve / fetchUrl）+ `createModel()`，
把 RAG 问答跑成无头 `AgentRun` 交给评测；评测逻辑与 W5 完全一致（评测即回归）。

