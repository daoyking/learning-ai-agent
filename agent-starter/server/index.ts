import 'dotenv/config';
import express from 'express';
import { streamText, convertToModelMessages } from 'ai';
import { createModel } from './model.js';
import { tools } from './tools.js';

const app = express();
app.use(express.json());
const model = createModel();

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const result = streamText({
    model,
    system: '你是友好的中文助手，需要时用工具回答用户问题。',
    // 关键（v7）：convertToModelMessages 返回 Promise，必须 await
    messages: await convertToModelMessages(messages),
    tools,
  });
  // 关键（v7）：UI 消息流直接灌给前端 useChat
  result.pipeUIMessageStreamToResponse(res);
});

const port = Number(process.env.PORT ?? 3005);
app.listen(port, () => {
  console.log(`✅ agent-starter 已启动: http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'missing') {
    console.warn('⚠️  未检测到 OPENAI_API_KEY，请在 .env 中配置');
  }
});
