import { createOpenAI } from '@ai-sdk/openai';

// 与 W2/W4 一致：用 createOpenAI().chat() 走 Chat Completions，
// 兼容 DeepSeek / 通义 / OpenRouter 等任意 OpenAI 兼容端点。
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'missing',
  baseURL: process.env.OPENAI_BASE_URL,
});

export const model = provider.chat(process.env.AI_MODEL ?? 'deepseek-chat');
