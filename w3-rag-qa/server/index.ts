import 'dotenv/config';
import express from 'express';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createModel } from './model.js';
import { tools } from './tools.js';
import { ingest } from './rag.js';

const app = express();
app.use(express.json());

const model = createModel();

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  const result = streamText({
    model,
    system:
      '你是一个基于本地知识库的问答助手。回答用户问题时遵循：\n' +
      '1) 先调用 retrieve 工具检索相关文档片段；\n' +
      '2) 若本地知识库不足以回答，可用 fetchUrl 工具抓取用户给出的网页或相关资料作为补充；\n' +
      '3) 严格依据检索/抓取到的内容作答，不得编造；\n' +
      '4) 在答案中用 [来源: 实际文件名] 或 [来源: URL] 注明引用出处，' +
      '例如 [来源: rag-explained.md]——必须写真实文件名，不要把「文件名」三个字照抄进答案；\n' +
      '5) 若确实无任何可用材料，坦诚说明知识库/网络中没有相关信息。',
    messages: await convertToModelMessages(messages),
    tools,
    // 小模型（本地 qwen3:14b）常会跳过检索直接凭记忆作答，RAG 演示就废了。
    // 只在第一步强制 retrieve，后续步骤交回模型决定（可继续检索、可补充抓取、可直接作答）。
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? ({ toolChoice: { type: 'tool', toolName: 'retrieve' } } as const)
        : {},
    // AI SDK v5+ 默认只跑 1 步：retrieve 返回片段后就结束，不会再基于检索结果作答。
    // 表现是「界面上能看到检索来源，但助手一句话都没有」——正是本工程要避免的。
    // 声明 stopWhen 后，检索结果回灌给模型继续生成，直到无更多工具调用或达到步数上限。
    stopWhen: stepCountIs(5),
  });

  // 把 UI 消息流（含文本增量 + 工具调用事件）直接灌给前端 useChat
  result.pipeUIMessageStreamToResponse(res);
});

const port = Number(process.env.PORT ?? 3002);
app.listen(port, async () => {
  console.log(`✅ RAG server 已启动: http://localhost:${port}`);
  try {
    const n = await ingest();
    console.log(`📚 已索引 ${n} 个文档片段`);
  } catch (e) {
    console.warn(
      `⚠️  知识库索引失败（对话仍可运行，但检索为空）：${(e as Error).message}`,
    );
  }
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'missing') {
    console.warn('⚠️  未检测到 OPENAI_API_KEY，请在 .env 中配置');
  }
});
