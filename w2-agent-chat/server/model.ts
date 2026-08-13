import { createOpenAI } from '@ai-sdk/openai';

// 兼容任意 OpenAI 协议的提供商：OpenAI 官方 / DeepSeek / 通义 / OpenRouter 等
// 只需改 .env 里的 OPENAI_BASE_URL 与 AI_MODEL 即可切换
export function createModel() {
  const provider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? 'missing',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  // 用 .chat() 走 Chat Completions 协议，兼容 OpenAI / DeepSeek / 通义 / OpenRouter 等
  // （默认 Responses API 仅 OpenAI 官方支持，国内服务商不支持）
  return provider.chat(process.env.AI_MODEL ?? 'gpt-4o-mini');
}
