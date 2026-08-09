import 'dotenv/config';
import express from 'express';
import { streamText, convertToModelMessages } from 'ai';
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
      '4) 在答案中用 [来源: 文件名] 或 [来源: URL] 注明引用出处；\n' +
      '5) 若确实无任何可用材料，坦诚说明知识库/网络中没有相关信息。',
    messages: await convertToModelMessages(messages),
    tools,
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
