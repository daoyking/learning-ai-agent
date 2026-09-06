# W3 RAG 阶段一基线评测报告（最小 RAG 链）

- 题数：50（事实 30 / 多跳 10 / 陷阱 10）
- 检索命中率(precision@3)：90%
- 忠实率：90%
- 回答正确率：76%

## 按类别

| 类别 | 题数 | 检索命中 | 忠实率 | 正确率 |
|---|---|---|---|---|
| 事实 | 30 | 87% | 93% | 83% |
| 多跳 | 10 | 100% | 70% | 30% |
| 陷阱 | 10 | n/a | 100% | 100% |

## 逐题明细

| # | id | 类别 | 检索命中 | 忠实 | 正确 | 关键理由 |
|---|---|---|---|---|---|---|
| 1 | b-fact-01 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 2 | b-fact-02 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 3 | b-fact-03 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 4 | b-fact-04 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 5 | b-fact-05 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 6 | b-fact-06 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 7 | b-fact-07 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 8 | b-fact-08 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 9 | b-fact-09 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 10 | b-fact-10 | fact | 1 | ❌ | ❌ | (复用前次运行结果) |
| 11 | b-fact-11 | fact | 0 | ❌ | ❌ | (复用前次运行结果) |
| 12 | b-fact-12 | fact | 0 | ✅ | ❌ | (复用前次运行结果) |
| 13 | b-fact-13 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 14 | b-fact-14 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 15 | b-fact-15 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 16 | b-fact-16 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 17 | b-fact-17 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 18 | b-fact-18 | fact | 0 | ✅ | ❌ | (复用前次运行结果) |
| 19 | b-fact-19 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 20 | b-fact-20 | fact | 0 | ✅ | ❌ | (复用前次运行结果) |
| 21 | b-fact-21 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 22 | b-fact-22 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 23 | b-fact-23 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 24 | b-fact-24 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 25 | b-fact-25 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 26 | b-fact-26 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 27 | b-fact-27 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 28 | b-fact-28 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 29 | b-fact-29 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 30 | b-fact-30 | fact | 1 | ✅ | ✅ | (复用前次运行结果) |
| 31 | b-multi-01 | multihop | 1 | ❌ | ❌ | (复用前次运行结果) |
| 32 | b-multi-02 | multihop | 1 | ✅ | ❌ | (复用前次运行结果) |
| 33 | b-multi-03 | multihop | 1 | ✅ | ✅ | (复用前次运行结果) |
| 34 | b-multi-04 | multihop | 1 | ✅ | ❌ | 参考资料仅提到“求职期别碰模型微调/自训，检索（RAG）足够做出像样的作品集”，并未展开 RAG 的索引/检索/生成等步骤，因此模型回答指出资料中未提及 RAG 具体步骤是忠实于资料的；但期望要点要求说明三个阶段都不需要训练模型，模型未覆盖该要点，故不正确。 |
| 35 | b-multi-05 | multihop | 1 | ✅ | ✅ | 模型回答完全基于参考资料，引用了 frontend-to-ai.md 中的三项能力迁移（TS/JS+异步、组件化与状态管理、Web API/JSON/fetch），并结合 agent-basics.md 中工具调用的本地执行机制进行解释，未出现资料外断言。回答覆盖了期望要点中的「Web API / JSON / fetch 接外部服务、处理返回结果的经验」，同时补充了异步编程与组件化可视化两个相关要点，内容准确且更全面。 |
| 36 | b-multi-06 | multihop | 1 | ✅ | ❌ | 模型回答指出参考资料中未提及 ReAct 循环，因此无法基于资料作答，这符合 faithful 要求（无资料外断言）。但期望要点要求说明「检索拿到片段」对应 ReAct 的 Observe 步骤，模型未覆盖该要点，故 correct 为 false。 |
| 37 | b-multi-07 | multihop | 1 | ❌ | ❌ |  |
| 38 | b-multi-08 | multihop | 1 | ✅ | ✅ | 回答完全基于提供的参考资料，引用准确，未引入资料外信息。同时覆盖了期望要点：RAG 无需训练模型（求职期避开微调）、前端 TS/Node 可串起检索→生成流程、流式 UI 呈现、门槛低易出作品集，且表述准确。 |
| 39 | b-multi-09 | multihop | 1 | ❌ | ❌ | The user asks: "Agent 需要 Memory 支撑多轮，前端工程师的什么能力正好适配这一点？" Expected answer: "前端的组件化与状态管理能力正好用来保留/管理多轮对话历史". The model answer says: "前端工程师的「组件化与状态管理」能力正好适配 Agent 需要 Memory 支撑多轮对话这一点。资料中指出：前端工程师擅长的「组件化与状态 |
| 40 | b-multi-10 | multihop | 1 | ✅ | ❌ | The answer correctly summarizes two advantages (TS/Node integration and streaming UI/componentization) from the reference materials but completely omits the third expected advantage: that front-end engineers can produce a portfolio using RA |
| 41 | b-trap-01 | trap | - | ✅ | ✅ | 模型回答准确指出知识库中未提及使用 GPT-4 做 embedding，参考资料 [3] 仅泛泛描述 RAG 流程中的向量化步骤，未指定任何具体嵌入模型，因此回答完全基于参考资料且正确处理了陷阱题。 |
| 42 | b-trap-02 | trap | - | ✅ | ✅ | The answer correctly states that the knowledge base does not mention Agent training LLM, cites the relevant advice against self-training and the definition of Agent, and does not hallucinate. |
| 43 | b-trap-03 | trap | - | ✅ | ✅ | 模型回答准确反映了参考资料的核心观点：前端转 AI 应用层不需要先学 PyTorch 等深度学习框架，资料明确建议避开模型微调/自训路线，优先用 TS/Node 调 LLM API、做 RAG 等应用层工作。回答未引入资料外信息，正确处理了陷阱题。 |
| 44 | b-trap-04 | trap | - | ✅ | ✅ | 模型回答准确指出知识库中未直接对比 RAG 与微调的效果优劣，仅引用了 frontend-to-ai.md 中针对前端工程师求职作品集的建议，并明确说明这并非通用的效果对比结论。回答完全基于提供的参考资料，无任何资料外断言或幻觉。 |
| 45 | b-trap-05 | trap | - | ✅ | ✅ | 模型正确识别出参考资料中完全没有提及 bge-m3，明确回答「知识库中未提及」并总结了资料实际涵盖的内容，未产生任何资料外的幻觉断言，符合陷阱题的预期处理方式。 |
| 46 | b-trap-06 | trap | - | ✅ | ✅ | The model correctly states that the reference materials do not mention the number of natural languages RAG supports, and does not fabricate any information. |
| 47 | b-trap-07 | trap | - | ✅ | ✅ | 模型正确指出参考资料中未提及任何具体向量数据库产品，仅提到“存入向量库”这一通用步骤，未给出 Pinecone、Weaviate、Milvus、Chroma、Qdrant 等具体推荐，因此回答完全基于资料且无幻觉，陷阱题处理得当。 |
| 48 | b-trap-08 | trap | - | ✅ | ✅ | 模型正确识别出参考资料中不包含 Agent 系统提示词的编写指南，明确声明「知识库中未提及」而非编造内容，符合陷阱题要求。 |
| 49 | b-trap-09 | trap | - | ✅ | ✅ | 模型正确指出参考资料中完全没有薪资数据，明确声明「知识库中未提及」，未编造任何数字或范围，符合陷阱题要求。 |
| 50 | b-trap-10 | trap | - | ✅ | ✅ | 模型准确指出知识库中未包含 RAG 生产环境部署相关内容，并正确概括了参考资料 [1][2][3] 的实际涵盖范围（前端转型建议、RAG 基本原理与流程），未添加任何资料外断言，符合陷阱题要求。 |