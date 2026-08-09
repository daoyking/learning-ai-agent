# Eval 报告（离线示例）

> ⚠️ **本文件由 w5 评测管线的同构逻辑生成，但使用了零依赖 mock judge / mock agent**。评分为示例值，仅用于展示报告格式与管线串联。
> 真实评测：在 `w5-agent-eval` 目录配置 `OPENAI_API_KEY` 后运行 `npm run eval` 即可生成真实打分报告。

- 用例数：2
- 通过率：100%
- 加权均分：8.8/10

### calc-1 · 得分 8.8 ✅（工具调用 1 次）
- 调用工具: 9/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。
- 结果正确: 8/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。
- 有解释: 10/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。

### rag-1 · 得分 8.8 ✅（工具调用 1 次）
- 调用检索: 8/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。
- 概念准确: 9/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。
- 降低幻觉: 10/10 ✅ — （离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。

---

## 本地 Tracer 时间线（等价 Langfuse 接收内容）

运行 `npm run demo`（w5-agent-eval）会输出如下结构的 trace；配置 `LANGFUSE_PUBLIC_KEY/SECRET_KEY` 后，
同一份 span 树会自动 flush 到 Langfuse（trace 名 `agent-eval`，`model:` 前缀 span 映射为 generation）。

| # | Span | 父级 | 耗时(ms) |
|---|---|---|---|
| 1 | agent:run | — | 63 |
| 2 | retrieve | agent:run | 21 |
| 3 | tool:calculator | agent:run | 11 |
| 4 | model:generate | agent:run | 31 |

**总 span 数**：4 · **累计耗时**：126ms
