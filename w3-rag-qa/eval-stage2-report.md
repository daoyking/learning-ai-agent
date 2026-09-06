# W3 RAG 阶段二（检索重排 + 自分解作答） 评测报告

- 题数：50（事实 30 / 多跳 10 / 陷阱 10）
- 检索命中率(precision@3)：90%
- 忠实率：80%
- 回答正确率：72%

## 按类别

| 类别 | 题数 | 检索命中 | 忠实率 | 正确率 |
|---|---|---|---|---|
| 事实 | 30 | 87% | 90% | 80% |
| 多跳 | 10 | 100% | 40% | 30% |
| 陷阱 | 10 | n/a | 90% | 90% |

## 逐题明细

| # | id | 类别 | 检索命中 | 忠实 | 正确 | 关键理由 |
|---|---|---|---|---|---|---|
| 1 | b-fact-01 | fact | 1 | ✅ | ✅ | 回答准确给出了 RAG 的英文全称 Retrieval-Augmented Generation 及其中文含义 检索增强生成，均直接来自参考资料 [1] 和 [2]，且未添加任何资料外内容。 |
| 2 | b-fact-02 | fact | 1 | ✅ | ✅ | 模型回答严格依据参考资料 `rag-explained.md` 作答，每条要点均标注来源且内容与原文一致。核心动作「先查资料（检索）」、三步流程「索引→检索→生成」、以及原因「基于私有/最新知识而非训练记忆」均完整覆盖了期望要点，无资料外断言。 |
| 3 | b-fact-03 | fact | 1 | ✅ | ✅ | 回答完整列出了索引、检索、生成三个阶段，且每阶段的描述均直接引用自参考资料 [1]，没有引入资料外信息，完全覆盖了期望要点。 |
| 4 | b-fact-04 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]，准确覆盖了索引阶段的三个核心步骤（文档切分、向量化、存入向量库），并补充了参考资料中「为什么需要分块」段落的内容（分块原因及建议大小），所有断言均有来源标注，无资料外臆造。 |
| 5 | b-fact-05 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料：明确说明用户问题向量化、使用余弦相似度进行初步检索，并补充了参考资料中提到的可选重排步骤，覆盖了期望要点且无资料外断言。 |
| 6 | b-fact-06 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]第3步内容，准确拆解了Generate阶段拼入内容（检索片段作上下文）、目的（据此作答而非靠参数记忆）及额外要求（注明来源），覆盖所有期望要点且无资料外断言。 |
| 7 | b-fact-07 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料，逐条引用了文档中关于分块必要性的所有关键点：上下文窗口限制、噪声与检索精度、粒度权衡（过大召回泛、过小断章取义）以及常见分块大小范围（200–500 字），无任何资料外断言，且覆盖了期望要点。 |
| 8 | b-fact-08 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料，准确给出常见 200–500 字的分块范围，并解释了过大/过小的影响，覆盖了期望要点。 |
| 9 | b-fact-09 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料 rag-explained.md，逐条引用了原文中的“chunk 太大召回泛”“太小容易断章取义”“常见 200–500 字”以及分块的根本原因，无任何资料外断言；同时覆盖了期望要点中要求的“太大召回泛、太小容易断章取义”，并准确给出了推荐分块大小与分块必要性，内容准确完整。 |
| 10 | b-fact-10 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]中的重排描述，准确覆盖了执行时机（检索topK之后）、使用模型/方法（精排模型/cross-encoder）及目的（提升相关性）三个子要点，无资料外断言。 |
| 11 | b-fact-11 | fact | 0 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided reference materials and expected points. The task is to output a JSON with "faithful", "correct", and "reason".

First, let's ana |
| 12 | b-fact-12 | fact | 0 | ❌ | ❌ | {"fa |
| 13 | b-fact-13 | fact | 1 | ✅ | ❌ | 模型回答准确指出参考资料中不包含 ReAct 循环的内容，未引入外部知识，符合 faithful；但未提供期望的四个步骤，因此未覆盖期望要点，correct 为 false。 |
| 14 | b-fact-14 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]中的「工具调用（Tool Calling）」段落，准确提取了「函数名+参数」的返回结构及「本地代码执行→结果回灌模型」的后续流程，覆盖了期望要点且无资料外断言。 |
| 15 | b-fact-15 | fact | 1 | ✅ | ✅ | 回答准确引用参考资料[1]中的核心结论：工具描述质量直接决定模型是否在正确时机调用工具，覆盖了期望要点。对于未在资料中提及的ReAct循环成败及任务整体准确性/效率，回答明确标注"知识库中未提及"，未做资料外推断，符合忠实性要求。 |
| 16 | b-fact-16 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料 [1] agent-basics.md，准确指出工具调用由本地代码执行、结果回灌给模型、随后进入 ReAct 核心循环（Reason→Act→Observe→Reason），覆盖了期望要点“回灌给模型（作为下一步输入）”，且无资料外断言。 |
| 17 | b-fact-17 | fact | 1 | ✅ | ✅ | The answer faithfully summarizes the single sentence from agent-basics.md about Memory, covering both short-term (context window) and long-term (external storage) aspects, and correctly notes the absence of further details in the provided r |
| 18 | b-fact-18 | fact | 0 | ✅ | ❌ | 模型回答诚实地指出参考资料中完全缺失关于多轮对话 Memory 的内容，未产生任何资料外断言，符合 faithful 要求；但期望要点明确要求回答「需要把历史消息保留在上下文窗口」，模型未给出该核心解释，因此未覆盖期望要点，correct 为 false。 |
| 19 | b-fact-19 | fact | 1 | ✅ | ✅ | 模型回答的四个子要点均直接来源于参考资料 agent-basics.md：第 1 点对应核心定义「自主决定调用哪些工具」，第 2 点对应 ReAct 核心循环描述，第 3 点对应工具调用段中「描述决定模型是否在正确时机调用工具」，第 4 点对应记忆段中「多轮对话需保留历史或外部存储」。回答未引入资料外断言，且完整覆盖了期望要点「自主决定调用哪些工具来完成任务」。 |
| 20 | b-fact-20 | fact | 0 | ✅ | ❌ | 模型回答指出参考资料中未包含 ReAct 相关内容，这与提供的资料一致，故 faithful 为真。但期望要点为「观察工具执行的结果」，模型未给出该定义，未覆盖期望要点，故 correct 为假。 |
| 21 | b-fact-21 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料，逐条引用了「能力迁移」「护城河」「避坑指南」三大核心论据，且均标注来源，无任何资料外断言；同时覆盖了期望要点中「能力迁移被验证是优势赛道」的核心逻辑，并补充了护城河与低门槛路径，准确回答了用户问题。 |
| 22 | b-fact-22 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料 [1] 中的「能力迁移」段落，准确列举了 TS/JS+异步、流式 UI 与打字机效果、组件化与状态管理三项可迁移能力，并备注了 Web API/JSON/fetch，满足「至少两项」的要求，无资料外断言。 |
| 23 | b-fact-23 | fact | 1 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided reference materials and expected key points. I need to output a JSON with three fields: faithful (boolean), correct (boolean), an |
| 24 | b-fact-24 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料，准确提取了「不要一上来啃微积分/线性代数」及其原因（模型研究员路径、ROI 低、易劝退），并补充了资料中同段落给出的正向路径（先用 TS/Node 调 LLM API、再补 Python/算法）与求职期避坑（不碰微调/自训、用 RAG 做作品集），无任何资料外断言，覆盖了期望要点且内容准确。 |
| 25 | b-fact-25 | fact | 1 | ✅ | ✅ | 模型回答准确引用参考资料，明确指出文章建议“先用自己会的 TS/Node 调 LLM API 拿正反馈”，并覆盖了期望要点，无资料外断言。 |
| 26 | b-fact-26 | fact | 1 | ✅ | ✅ | 模型回答准确引用参考资料中的核心建议——「求职期别碰模型微调/自训」，并补充了资料中同段落给出的替代路径（RAG 足够做作品集、先用 TS/Node 调 API 再补 Python），内容完全基于提供的文档，无外部臆断，且完整覆盖了期望要点。 |
| 27 | b-fact-27 | fact | 1 | ✅ | ✅ | 回答准确引用参考资料 frontend-to-ai.md 中的原文「检索（RAG）足够做出像样的作品集」，并围绕该核心结论补充了适用人群（前端转 AI 应用）、避坑指引（别碰微调/自训/微积分）及结合前端优势的实现路径（TS/Node 调 API、流式 UI、组件化封装），均严格基于提供的资料，未引入任何外部知识。同时诚实列出资料中未提及的细节（向量库选型、Embedding 模型、完整技术栈清单），完全符合 faithful 与 correct 要求。 |
| 28 | b-fact-28 | fact | 1 | ✅ | ✅ | The model answer accurately captures the three core moat points from the reference materials (streaming typing, step visualization, graceful error retry) and adds a fourth point about frontend engineering skills that is also supported by th |
| 29 | b-fact-29 | fact | 1 | ✅ | ✅ | 模型回答完全基于参考资料，准确列出了组件化与状态管理能优雅封装的两个要点（工具调用可视化、中间步骤时间线），并正确指出这是前端工程师转型 AI 应用开发的核心能力迁移之一，无资料外断言，覆盖了所有期望要点。 |
| 30 | b-fact-30 | fact | 1 | ✅ | ✅ | 回答完全基于参考资料，准确提取了「带流式打字、步骤可视化、错误重试优雅的界面能力」作为核心要点，并正确关联了算法背景弱项、市场稀缺点、产品价值及前端优势，所有论点均有文档出处支撑，无资料外断言。 |
| 31 | b-multi-01 | multihop | 1 | ❌ | ❌ | {"faithful": true, "correct": false, "reason": "回答完全基于参考资料，未出现资料外断言，故 faithful=true。但期望要点包含四点：①流式UI呈现检索结果、②组件化/状态管理封装步骤时间线、③Web API/fetch接模型、④RAG无需训练模型。回答覆盖了①②， |
| 32 | b-multi-02 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate the model's response based on the provided user question, expected points, and reference materials. I need to output a JSON with "faithful", "correct", and "reason".

Fir |
| 33 | b-multi-03 | multihop | 1 | ✅ | ✅ | 模型回答完全基于参考资料[1]生成，未引入外部信息。回答准确覆盖了三个核心期望要点：1) 前端流式 UI/打字机效果天然契合 LLM 逐 token 输出；2) 组件化与状态管理可优雅封装工具调用可视化、步骤时间线等复杂交互；3) 算法背景开发者在产品级界面打磨（流式打字、步骤可视化、错误重试）上普遍薄弱，市场稀缺此类能力，从而形成前端转型者的护城河。 |
| 34 | b-multi-04 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate the model's answer based on the provided context (user question, expected points, reference materials, model answer). I need to output a JSON with "faithful", "correct",  |
| 35 | b-multi-05 | multihop | 1 | ❌ | ❌ | {"faithful": true, "correct": true, "reason": "模型回答完全基于提供的参考资料[1][2][3]，未引入外部知识。要点1引用[3]解释本地代码执行机制；要点2、3、4分别对应[1][2]中列出的三项能力迁移（异步编程、组件化状态管理、Web |
| 36 | b-multi-06 | multihop | 1 | ✅ | ❌ | 模型回答准确指出参考资料中未包含 ReAct 循环的任何信息，因此无法依据资料给出映射关系，未做任何资料外断言，符合 faithful 要求。但期望要点明确要求回答「对应 Observe（观察外部结果）」，模型未给出该对应关系，未覆盖期望要点，故 correct 为 false。 |
| 37 | b-multi-07 | multihop | 1 | ✅ | ✅ | 回答完全基于参考资料[1][2][3]，准确提炼了流式打字、步骤可视化、错误重试优雅界面三大能力，并结合 Agent ReAct 循环与工具调用特性解释了体验提升路径，最后精准对应护城河原文「带流式打字、步骤可视化、错误重试优雅的界面」且指出其为算法背景开发者最弱、市场最缺的产品级交互工程化能力，覆盖所有期望要点且无资料外断言。 |
| 38 | b-multi-08 | multihop | 1 | ✅ | ✅ | 模型回答完全基于提供的参考资料（frontend-to-ai.md 与 rag-explained.md），未引入任何资料外断言；且逐条覆盖了期望要点：RAG 免训练、低门槛、前端可用 TS/Node 串起检索→生成流程、流式 UI 呈现、资料明确指出 RAG 足以做作品集、前端还能将中间过程可视化形成护城河。 |
| 39 | b-multi-09 | multihop | 1 | ❌ | ❌ | The user is asking me to evaluate a model answer against the reference materials. The model answer provided is a detailed response about frontend engineer capabilities fitting Agent memory for multi-t |
| 40 | b-multi-10 | multihop | 1 | ❌ | ❌ | The user wants me to evaluate a model answer against a user question, expected key points, and reference documents. I need to output a JSON with three fields: faithful (boolean), correct (boolean), an |
| 41 | b-trap-01 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，准确指出知识库中仅在「该避的坑」一节提到 RAG 作为检索技术可用于作品集，未涉及 embedding 模型选型、未提及 GPT-4，也未建议用 GPT-4 做 embedding。回答无任何资料外断言，正确处理了陷阱题。 |
| 42 | b-trap-02 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，未引入任何外部知识。针对陷阱问题「Agent 能自己训练大语言模型吗」，参考资料仅讨论人类前端工程师求职期是否应碰模型微调/自训，未涉及 Agent 自身具备训练模型的能力。模型在要点 3 明确指出「知识库中未提及 Agent 能否自主训练大语言模型」，正确处理了陷阱题，避免了幻觉。 |
| 43 | b-trap-03 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，准确指出前端转 AI 推荐定位为 AI 应用工程师，核心优势在于 TS/JS 技术栈可直接调用 LLM API、构建流式 UI 与 Agent 交互界面，入门阶段应避开模型训练/微调（涉及 PyTorch 等框架），优先用 RAG 与工具调用做作品集，Python 与算法可在拿到正反馈后再补，非硬性前置门槛。回答未引入参考资料之外的信息，正确处理了陷阱题（明确说明 PyTorch 非应用层必备）。 |
| 44 | b-trap-04 | trap | - | ✅ | ✅ | 模型回答准确指出参考资料未直接对比 RAG 与微调的通用优劣，仅针对前端工程师转型求职场景建议优先用 RAG、暂不碰微调，且未引入任何参考资料之外的信息。 |
| 45 | b-trap-05 | trap | - | ✅ | ✅ | 模型回答明确指出三份参考资料均未涉及 bge-m3，所有子要点均标注为「知识库中未提及」，未编造任何资料外信息，正确处理了陷阱题。 |
| 46 | b-trap-06 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，明确指出三份资料均未涉及 RAG 支持的自然语言种类或数量，未编造任何资料外信息；针对陷阱题正确处理为「知识库中未提及」，符合要求。 |
| 47 | b-trap-07 | trap | - | ✅ | ✅ | 模型回答完全基于参考资料，准确指出三份文档均未提及任何具体向量数据库产品名称（如 Pinecone、Milvus、Chroma 等），仅在 rag-explained.md 中笼统提到「存入向量库」。模型正确处理了陷阱题，明确声明知识库中未提及，未产生任何资料外断言。 |
| 48 | b-trap-08 | trap | - | ✅ | ✅ | 模型回答明确指出参考资料未直接提供 Agent 系统提示词的完整内容或模板，并仅基于资料 [2] 中的 ReAct 循环、工具调用机制、记忆管理等概念进行合理推断，未编造资料外的具体提示词措辞或模板，正确处理了陷阱题。 |
| 49 | b-trap-09 | trap | - | ❌ | ❌ | The user is asking about the average salary for frontend engineers transitioning to AI. I need to check if the provided reference materials contain any salary information.

Looking at the reference ma |
| 50 | b-trap-10 | trap | - | ✅ | ✅ | 模型回答准确指出参考资料中未涉及 RAG 生产环境部署、向量数据库运维、监控、CI/CD、安全合规等内容，且未编造任何资料外信息，正确处理了陷阱题。 |