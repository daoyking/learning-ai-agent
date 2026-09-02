import 'dotenv/config';
import express from 'express';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createModel } from './model.js';
import { tools } from './tools.js';
import { buildMemoryContext, remember, isMemoryAvailable } from './memory.js';

const app = express();
app.use(express.json());

const model = createModel();

const BASE_SYSTEM =
  '你是一个友好的中文助手，善于在合适的时候调用工具来回答用户问题。' +
  '能用工具获取准确信息时优先使用工具，而不是凭空猜测。\n' +
  '可用工具：getCurrentTime(当前时间)、calculator(计算)、getWeather(天气示例)、' +
  'readFile(读取 server/docs/ 下的本地文档)、fetchUrl(抓取网页正文)。\n' +
  '当用户问到「读一下/总结某份文档/某个 md 文件」时，调用 readFile；' +
  '当用户想了解某个网页或实时网络内容时，调用 fetchUrl。';

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const lastUserMsg =
    [...messages].reverse().find((m: { role?: string }) => m.role === 'user')?.content ?? '';

  // 1) 用最后一条用户消息召回历史记忆，注入 system prompt
  let memoryCtx = '';
  try {
    memoryCtx = lastUserMsg ? await buildMemoryContext(String(lastUserMsg)) : '';
  } catch (e) {
    console.warn('[memory] 召回失败（忽略）:', (e as Error).message);
  }
  const system = memoryCtx ? `${BASE_SYSTEM}\n\n${memoryCtx}` : BASE_SYSTEM;
  if (memoryCtx) {
    console.log(`[memory] 已召回相关记忆并注入上下文（${memoryCtx.split('\n').length - 1} 条）`);
  }

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    tools,
    // AI SDK v5+ 默认只跑 1 步：模型返回工具调用后就结束，不会再基于工具结果作答。
    // 表现是「界面上看到工具被调用、返回了结果，但助手一句话都没说」。
    // 声明 stopWhen 后，工具结果会回灌给模型继续生成，直到没有更多工具调用或达到步数上限。
    stopWhen: stepCountIs(5),
    onFinish: async ({ text }) => {
      // 2) 对话结束后把本轮内容记入长期记忆（后续会话可召回）
      if (lastUserMsg && text) {
        try {
          await remember(`用户：${lastUserMsg}\n助手：${text.slice(0, 300)}`, { type: 'chat' });
          console.log('[memory] 已保存本轮对话到长期记忆');
        } catch (e) {
          console.warn('[memory] 保存失败（忽略）:', (e as Error).message);
        }
      }
    },
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
  isMemoryAvailable().then((ok) =>
    console.log(
      ok
        ? '🧠 记忆服务已连接（agentmemory @ localhost:3111）'
        : '⚠️  记忆服务未启动：需另开终端运行 npx -y @agentmemory/agentmemory（数据目录 data/）',
    ),
  );
});
