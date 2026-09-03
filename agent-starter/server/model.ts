import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';

// dotenv 加载放在这里（共享模块）而不是入口文件：工程一旦有第二个入口
// （如 evals/run.ts、tests/），只在 server/index.ts 写会漏掉那条链路，
// 导致环境变量静默为 undefined。
// AI_MODEL 缺失时直接报错而非 fallback：'gpt-4o-mini' 这类「看起来合理」的
// 默认值会把「配置没生效」伪装成「模型不好用」，排查方向直接跑偏。
export function createModel() {
  const modelId = process.env.AI_MODEL;
  if (!modelId) {
    throw new Error(
      '[model] AI_MODEL 未设置。请复制 .env.example 为 .env 并填入 AI_MODEL / OPENAI_BASE_URL / OPENAI_API_KEY。\n' +
        '[model] 故意不提供 fallback：静默使用错误模型会极难排查。',
    );
  }
  const provider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? 'missing',
    baseURL: process.env.OPENAI_BASE_URL,
  });
  // 关键（v7）：用 .chat() 走 Chat Completions，兼容 DeepSeek / 通义 / OpenRouter
  return provider.chat(modelId);
}
