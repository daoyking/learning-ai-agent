import { createOpenAI } from '@ai-sdk/openai';

export function createModel() {
  const provider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? 'missing',
    baseURL: process.env.OPENAI_BASE_URL,
  });
  // 关键（v7）：用 .chat() 走 Chat Completions，兼容 DeepSeek / 通义 / OpenRouter
  return provider.chat(process.env.AI_MODEL ?? 'gpt-4o-mini');
}
