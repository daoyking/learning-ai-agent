# Eval 报告

- 用例数：3
- 通过率：0%
- 加权均分：0.47/10

### calc-1 · 得分 1 ❌ · 工具调用 0 次
- 调用工具: 0/10 ❌ — Agent 实际未调用 calculator 工具，只输出了一条未执行的指令。
- 结果正确: 0/10 ❌ — Agent 实际未调用任何工具。
- 有解释: 5/10 ❌ — Agent 实际未调用任何工具

### rag-1 · 得分 0.4 ❌ · 工具调用 0 次
- 调用检索: 0/10 ❌ — Agent 未调用 searchDocs 工具检索 RAG 资料，直接回答了什么是 RAG，未按要求使用工具。
- 概念准确: 0/10 ❌ — Agent未调用searchDocs检索RAG片段即作答。
- 降低幻觉: 2/10 ❌ — 未调用searchDocs工具进行资料检索

### multi-1 · 得分 0 ❌ · 工具调用 0 次
- 调用检索: 0/10 ❌ — Agent 未实际调用任何工具。
- 调用计算: 0/10 ❌ — Agent 实际未调用任何工具。
- 结果完整: 0/10 ❌ — Agent 未调用任何工具。

## 🔭 Trace 时间线

| # | Span | 父级 | 耗时(ms) | 关键属性 |
|---|---|---|---|---|
| 1 | eval:calc-1 | — | 23575 | — |
| 2 | agent:run | span_1 | 11389 | — |
| 3 | eval:rag-1 | — | 22965 | — |
| 4 | agent:run | span_3 | 8093 | — |
| 5 | eval:multi-1 | — | 18872 | — |
| 6 | agent:run | span_5 | 6439 | — |

**总 span 数**：6 · **累计耗时**：91333ms

---

> 这份是**修复前的基线**，当时 `AI_MODEL=qwen2.5-coder:14b`（该模型在 Ollama 的
> OpenAI 兼容端点下不产生 `tool_calls`，只把工具调用以 JSON 文本输出正文），
> 且 `src/cli.ts` 缺 `import 'dotenv/config'` 导致 `.env` 从未被加载。
> 三个用例**工具调用均为 0 次**。详见 [ITERATION.md](./ITERATION.md)。
