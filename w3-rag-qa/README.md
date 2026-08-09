# W3 · RAG 流式问答站

前端转 Agent 的第三个练手项目：**检索增强生成（RAG）**。把「检索」封装成一个工具，
模型自主调用 `retrieve` 从本地知识库取回相关片段，再带引用流式作答。前端把
检索来源（文件名 + 相似度 + 片段）实时可视化——这正是前端工程师做 AI 产品的护城河。

## 技术栈
- 后端：Express + `ai`（`streamText` / `embedMany` / `embed`）+ `@ai-sdk/openai`
- 前端：Vite + React + `@ai-sdk/react`（`useChat`）
- 检索：纯内存向量库（分块 → OpenAI embedding → 余弦相似度 topK），零外部向量库依赖
- 流式协议：AI SDK UI Message Stream

## 运行
```bash
cp .env.example .env   # 填入 API key（Embedding 默认用 OpenAI text-embedding-3-small）
npm install
npm run dev            # 同时起后端(3002) 与前端(5174)
```
打开 http://localhost:5174

> 注意：DeepSeek 不提供 embedding，若用 DeepSeek 聊天模型，embedding 仍需 OpenAI key。

## 这个工程教什么
1. **RAG 三阶段**：Ingest（分块+向量化）→ Retrieve（余弦相似度）→ Generate（带引用生成）。
2. **检索即工具**：把 `retrieve` 做成 tool，复用 Agent 循环，无需单独编排检索链。
3. **Embedding 用法**：`embedMany` 批量索引、`embed` 单条查询，provider 用 `.embedding()`。
4. **真实工具增强**：`fetchUrl` 工具无需额外 key，可抓取网页作为实时知识源，本地库不足时补充检索。
5. **前端差异化**：检索来源清单（文件名/相似度/片段）与抓取来源（URL）的可视化，是作品集亮点。

## 下一步
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

