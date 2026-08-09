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
    system:
      '你是一个友好的中文助手，善于在合适的时候调用工具来回答用户问题。' +
      '能用工具获取准确信息时优先使用工具，而不是凭空猜测。\n' +
      '可用工具：getCurrentTime(当前时间)、calculator(计算)、getWeather(天气示例)、' +
      'readFile(读取 server/docs/ 下的本地文档)、fetchUrl(抓取网页正文)。\n' +
      '当用户问到「读一下/总结某份文档/某个 md 文件」时，调用 readFile；' +
      '当用户想了解某个网页或实时网络内容时，调用 fetchUrl。',
    messages: await convertToModelMessages(messages),
    tools,
  });

  // 把 UI 消息流（含文本增量 + 工具调用事件）直接灌给前端 useChat
  result.pipeUIMessageStreamToResponse(res);
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`✅ Agent server 已启动: http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'missing') {
    console.warn('⚠️  未检测到 OPENAI_API_KEY，请在 .env 中配置后可正常对话');
  }
});
