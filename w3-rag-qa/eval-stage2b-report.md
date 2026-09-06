# W3 RAG 阶段二b（子问题拆解 + 严格引用） 评测报告

- 题数：50（事实 30 / 多跳 10 / 陷阱 10）
- 检索命中率(precision@3)：90%
- 忠实率：66%
- 回答正确率：56%

## 按类别

| 类别 | 题数 | 检索命中 | 忠实率 | 正确率 |
|---|---|---|---|---|
| 事实 | 30 | 87% | 77% | 63% |
| 多跳 | 10 | 100% | 10% | 0% |
| 陷阱 | 10 | n/a | 90% | 90% |

## 逐题明细

| # | id | 类别 | 检索命中 | 忠实 | 正确 | 关键理由 |
|---|---|---|---|---|---|---|
| 1 | b-fact-01 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料[3]，准确给出了RAG的英文全称Retrieval-Augmented Generation及中文翻译“检索增强生成”，并覆盖了期望要点，无资料外断言。 |
| 2 | b-fact-02 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]描述的 RAG 流程，详细解释了检索步骤的向量化、余弦相似度匹配及上下文拼接，并总结出 RAG 让模型先检索再生成，覆盖了期望要点中的“先检索（查资料）”与“基于私有/最新知识作答而非仅靠训练记忆”的核心含义，无资料外断言。 |
| 3 | b-fact-03 | fact | 1 | ✅ | ✅ | 模型回答准确列出了参考资料[3]中定义的三个阶段（索引、检索、生成），并对每个阶段的核心任务进行了基于资料的描述，未引入资料外信息，完全覆盖了期望要点。 |
| 4 | b-fact-04 | fact | 1 | ✅ | ✅ | 模型回答准确引用参考资料[1]给出的三步流程（切分→向量化→入库），覆盖了期望要点；对于资料未涉及的细节（文档加载解析、分块更多参数、嵌入存储工程细节）明确标注「知识库中未提及」，未引入任何外部知识，完全忠实于给定资料。 |
| 5 | b-fact-05 | fact | 1 | ✅ | ❌ | 模型回答忠实于参考资料（正确指出资料仅提到「向量化+余弦相似度」及可选重排，未涉及 BM25、双塔、ColBERT、RRF 等细节），但未能直接给出用户问题的核心答案——即「把问题向量化，用余弦相似度找出最相关的片段」。回答过度展开为未被提问的子问题，且未清晰呈现期望要点，导致 correct 为 false。 |
| 6 | b-fact-06 | fact | 1 | ❌ | ❌ | The user wants me to evaluate the model's response against the expected points and reference materials. The model response is a detailed analysis of the references and answers to four sub-questions. H |
| 7 | b-fact-07 | fact | 1 | ✅ | ✅ | 模型回答的核心部分（子问题1）完全基于参考资料[1]，准确覆盖了期望要点：文档过长超出上下文窗口、噪声大、分块提升检索精度。后续子问题诚实说明资料未提及，未产生幻觉。整体忠实于资料且正确回答了用户问题。 |
| 8 | b-fact-08 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料[1]给出的「常见 200–500 字」及分块过大/过小对检索的影响，未引入资料外信息；同时准确覆盖了期望要点，并诚实说明其余子问题在资料中未提及。 |
| 9 | b-fact-09 | fact | 1 | ✅ | ✅ | 模型回答准确引用参考资料[1]中的核心结论：分块过大导致「召回泛」、过小导致「断章取义」，并明确指出资料未提供更多细节（如噪声、成本、存储开销等）及确定最优大小的具体方法，无任何资料外断言，完全覆盖期望要点。 |
| 10 | b-fact-10 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]，准确描述了重排在RAG流程中的位置（检索后、生成前）、输入输出及其作用（对topK候选片段精排以提升相关性），并诚实指出资料未涉及打分机制、降噪原理、延迟成本等细节，无任何资料外断言，且覆盖了期望要点。 |
| 11 | b-fact-11 | fact | 0 | ❌ | ❌ | {"faithful": true, "correct": false, "reason": "模型回答准确指出参考资料中不包含 Agent 的定义、架构、与 LLM 的区别或应用场景等信息，完全基于参考资料且无外部断言， |
| 12 | b-fact-12 | fact | 0 | ✅ | ❌ | 模型回答诚实指出参考资料中未包含 Agent 与一次性问答的定义、对比或适用场景，未产生资料外断言，符合 faithful；但未覆盖期望要点“Agent 自主决定调用工具，一次性问答不调工具”，因此 correct 为 false。 |
| 13 | b-fact-13 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料[3]中的核心循环描述，准确列出了 Reason、Act、Observe、再 Reason 四个步骤及其顺序与功能，覆盖了期望要点且无资料外断言。 |
| 14 | b-fact-14 | fact | 1 | ✅ | ❌ | 模型回答忠实于参考资料，未编造资料中不存在的字段细节（如消息结构、工具调用 ID 等），但未覆盖期望要点中明确给出的核心结论：参考资料 [1] 直接指出「模型返回一个『函数名 + 参数』，由本地代码执行，再把结果回灌给模型」，模型回答仅逐条声称「知识库中未提及」，遗漏了这一关键高层描述，因此正确性不足。 |
| 15 | b-fact-15 | fact | 1 | ✅ | ✅ | 回答严格依据参考资料[1]作答，明确引用原文「描述（description）写得好不好，直接决定模型是否会在正确时机调用工具」覆盖了期望要点；对资料未涉及的功能理解深度、参数填充、任务完成率等子问题均标注「知识库中未提及」，无任何资料外断言，完全忠实且准确。 |
| 16 | b-fact-16 | fact | 1 | ✅ | ✅ | 回答准确引用参考资料[1]确认工具调用结果回灌给模型，覆盖了期望要点；同时诚实说明资料未涉及消息格式、上下文拼接细节及框架差异，无资料外断言。 |
| 17 | b-fact-17 | fact | 1 | ✅ | ✅ | 模型回答准确引用参考资料 [2] 中的原文，完整覆盖了期望要点：多轮对话保留历史消息在上下文窗口，以及借助外部存储做长期记忆。对于资料未提及的细节（读写机制对推理的影响、多类型记忆协作），回答明确标注「知识库中未提及」，未做任何资料外断言。 |
| 18 | b-fact-18 | fact | 0 | ✅ | ❌ | 模型回答完全基于参考资料，诚实指出资料中未涉及多轮对话 Memory 相关内容，符合 faithful 要求。但期望要点明确要求解释「需要把历史消息保留在上下文窗口」，模型未覆盖该要点，因此 correct 为 false。 |
| 19 | b-fact-19 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料[1]，准确引用了 Agent 自主性的核心定义（自主决定工具调用）和 ReAct 循环，并明确指出资料中未涉及目标设定、任务分解、自我反思等内容，无任何资料外断言；同时覆盖了期望要点“自主决定调用哪些工具来完成任务”，且表述准确。 |
| 20 | b-fact-20 | fact | 0 | ❌ | ❌ | The user is asking me to evaluate a model's response to a question about ReAct's Observe step. I need to check if the model's response is faithful to the reference materials and correct according to t |
| 21 | b-fact-21 | fact | 1 | ❌ | ❌ | The user wants me to evaluate the model's response based on the provided user question, expected points, reference materials, and the model's answer. I need to output a JSON with three fields: faithfu |
| 22 | b-fact-22 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]/[2]（两份内容相同），准确列举了四项可迁移能力：TS/JS+异步、流式UI与打字机效果、组件化与状态管理、Web API/JSON/fetch，且对参考资料未涉及的「模型部署与推理优化」明确标注「知识库中未提及」，无任何资料外断言。回答覆盖了期望要点中的所有四项能力，满足「至少两项」的要求，且引用格式规范。 |
| 23 | b-fact-23 | fact | 1 | ❌ | ❌ | The user wants me to evaluate a model's response based on the provided context (user question, expected points, reference materials, and model answer). I need to output a JSON with three fields: faith |
| 24 | b-fact-24 | fact | 1 | ✅ | ✅ | 模型回答直接引用参考资料中的核心警示——「不要一上来啃微积分/线性代数，那是模型研究员路径，ROI 低易劝退」，并准确覆盖了期望要点；其余内容亦均来自提供的参考资料，无资料外断言。 |
| 25 | b-fact-25 | fact | 1 | ✅ | ✅ | The answer accurately reflects the reference material, citing the exact advice to first use TS/Node to call LLM API for positive feedback before learning Python and algorithms, with no external assertions. |
| 26 | b-fact-26 | fact | 1 | ✅ | ✅ | 模型回答的「综合结论」部分准确引用了参考资料 [2][3] 中的核心建议——「求职期别碰模型微调/自训，检索（RAG）足够做出像样的作品集」，完全基于资料且覆盖了期望要点。前半段列出的四个子问题虽与用户提问无关，但均标注「知识库中未提及」，未引入资料外断言，整体符合 faithful 与 correct 标准。 |
| 27 | b-fact-27 | fact | 1 | ❌ | ❌ | {"faithful": true, "correct": true, "reason": "模型回答准确引用参考资料[2][3]核心观点：明确指出「检索（RAG）足够做出像样的作品集」，并列出前端迁移技术栈（TS/JS、异步、Node 调 LLM API、流 |
| 28 | b-fact-28 | fact | 1 | ✅ | ✅ | 回答准确引用参考资料中的核心护城河描述——「同样一个 Agent，你能做出带流式打字、步骤可视化、错误重试优雅的界面」，并覆盖了期望要点的三个关键能力（流式打字、步骤可视化、错误重试优雅）。其余内容亦均源自参考资料，无外部断言。 |
| 29 | b-fact-29 | fact | 1 | ❌ | ❌ | {"faithful": true, "correct": true, "reason": "模型回答完全基于参考资料，明确指出资料仅给出两个具体场景：组件化与状态管理能优雅封装「工具调用可视化」与「中间步骤时间线」，未涉及其他通用原则， |
| 30 | b-fact-30 | fact | 1 | ✅ | ✅ | The model answer accurately extracts the exact UI capabilities (streaming typing, step visualization, graceful error retry) from the reference material as the core weakness of algorithm-background students and the market's most lacking skil |
| 31 | b-multi-01 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate a model answer based on the provided context (user question, expected points, reference materials, model answer). I need to output a JSON with "faithful", "correct", and  |
| 32 | b-multi-02 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided reference materials and expected points. I need to output a JSON with "faithful", "correct", and "reason".

First, let's analyze  |
| 33 | b-multi-03 | multihop | 1 | ❌ | ❌ | {"faithful": true, "correct": true, "reason": "回答完全基于参考资料，准确引用了「流式打字、步骤可视化、错误重试优雅」构成护城河、「流式 UI 与打字机效果天然契合 LLM 逐 token 输出」、以及 TS/JS 异步、组件化状态管理、Web API 等前端工程化能力支撑 Agent 复杂状态。期望要点（LLM 逐 token 契合流式 UI、前端擅 |
| 34 | b-multi-04 | multihop | 1 | ❌ | ❌ | {"faithful": true, "correct": false, "reason": "模型回答忠实反映了参考资料中未展开 RAG 具体步骤（索引/检索/生成）的事实，未引入资料外断言，故 faithful=true。但期望要点明确要求指出「索引/检索/生成三个阶段都不需要训练模型」，模型回答仅说明 |
| 35 | b-multi-05 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided context (user question, expected points, reference materials, model answer). I need to output a JSON with "faithful", "correct",  |
| 36 | b-multi-06 | multihop | 1 | ✅ | ❌ | 模型回答完全基于提供的参考资料，诚实地说明资料中未提及 ReAct 循环，因此无法给出对应关系，这符合 faithful 要求。但期望要点明确指出「检索拿到片段」对应 ReAct 的 Observe 步骤，模型未给出该结论，未覆盖期望要点，故 correct 为 false。 |
| 37 | b-multi-07 | multihop | 1 | ❌ | ❌ | 模型回答未直接回答用户问题，而是反问三个问题并给出不完整的回答（截断于「流式打」），未覆盖期望要点中的「提升流式打字与步骤可视化体验」及「对应护城河中带流式打字、步骤可视化、错误重试优雅的界面」。且回答结构为提问而非陈述，不符合问答任务要求。 |
| 38 | b-multi-08 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided context (reference materials) and expected key points.

**Reference Materials Summary:**
- [1] & [2] (same content): Frontend eng |
| 39 | b-multi-09 | multihop | 1 | ❌ | ❌ | 模型回答并未回答用户问题，而是反问了四个问题，完全没有基于参考资料给出“前端组件化与状态管理能力适配 Agent Memory 多轮对话历史管理”这一核心要点，因此既不忠实于参考资料，也不正确覆盖期望要点。 |
| 40 | b-multi-10 | multihop | 1 | ❌ | ❌ | 模型回答完全偏离了用户问题。用户询问的是「前端工程师做 AI 应用的核心优势可以概括成哪三点」，期望要点明确为：1) TS/Node 串 LLM/Agent 流程；2) 流式UI与状态管理做体验；3) RAG/Agent 无需训练模型即可出作品集。模型却自行拆解为三个未被提问的子问题（UI交互优势、模型推理部署/边缘计算、产品快速迭代/数据飞轮），且第二、三子问题在参考资料中均未提及，导致回答既不忠实于问题，也未覆盖期望要点。 |
| 41 | b-trap-01 | trap | - | ✅ | ✅ | 模型回答准确指出参考资料中未提及 GPT-4 用于 embedding，也未给出任何 embedding 模型推荐、对比或选型建议，完全基于提供的资料，无幻觉。 |
| 42 | b-trap-02 | trap | - | ✅ | ✅ | 模型回答的每个子问题均明确指出「知识库中未提及」，并准确引用参考资料的实际内容（前端转型建议避开微调/自训、Agent 核心循环仅涉及工具调用编排），未添加任何参考资料之外的断言。针对陷阱问题（Agent 能否自训 LLM），模型正确处理为「资料未覆盖」，符合要求。 |
| 43 | b-trap-03 | trap | - | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided reference materials. The question is: "Does a frontend engineer transitioning to AI must learn PyTorch?" The reference materials  |
| 44 | b-trap-04 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，明确指出知识库中未包含 RAG 与微调的系统对比、实验、评测维度或通用结论，仅引用了资料中针对前端求职者的单一建议（用 RAG 做作品集、避免微调），未编造任何资料外信息，正确处理了陷阱题。 |
| 45 | b-trap-05 | trap | - | ✅ | ✅ | 模型回答明确指出参考资料中未提及 bge-m3 的任何信息，每个子问题均回答「知识库中未提及」，并给出综合结论说明资料仅涉及前端转型与 RAG 基础，未包含 bge-m3 相关内容。这完全基于提供的参考资料，无任何外部知识编造，且正确处理了陷阱题（资料中无答案时应说明未提及）。 |
| 46 | b-trap-06 | trap | - | ✅ | ✅ | 模型正确识别出所有参考资料均未提及 RAG 支持的自然语言种类、嵌入模型语言覆盖、大模型多语言能力或部署影响因素，对每个子问题均回答「知识库中未提及」，并给出准确的综合结论，无任何资料外断言。 |
| 47 | b-trap-07 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，未编造任何向量数据库产品名称或选型建议。参考资料三篇文档均未提及具体向量数据库产品、选型指标、部署偏好或预算信息，模型逐条指出「知识库中未提及」并给出无法推荐的结论，符合陷阱题要求。 |
| 48 | b-trap-08 | trap | - | ✅ | ✅ | 模型正确识别出三份参考资料均未涉及 Agent 系统提示词的编写内容、结构、最佳实践或反模式，对四个子问题均明确回答「知识库中未提及」，未编造任何资料外信息，符合陷阱题要求。 |
| 49 | b-trap-09 | trap | - | ✅ | ✅ | 模型回答逐条指出四个薪资相关子问题在参考资料中均未提及，未编造任何薪资数字、城市分布、年限影响或技能-薪资相关性数据，完全基于资料范围作答，正确处理了陷阱题。 |
| 50 | b-trap-10 | trap | - | ✅ | ✅ | 模型回答准确指出参考资料中完全没有涉及 RAG 生产环境部署、部署架构、技术栈选型、运维最佳实践或 CI/CD 示例等内容，且未编造任何资料外信息，正确处理了陷阱题。 |