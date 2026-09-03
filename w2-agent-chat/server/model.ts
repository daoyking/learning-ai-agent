import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';

// 兼容任意 OpenAI 协议的提供商：OpenAI 官方 / DeepSeek / 通义 / OpenRouter 等
// 只需改 .env 里的 OPENAI_BASE_URL 与 AI_MODEL 即可切换
//
// 注意 1：dotenv 加载放在这里（共享模块）而不是入口文件。本工程有多个入口
//   （npm start → server/index.ts，npm run eval → evals/run.ts，测试 → tests/），
//   只在某一个入口写 import 'dotenv/config' 会漏掉其它链路，
//   导致环境变量静默为 undefined。放在共享模块里，任何入口都会自动加载。
// 注意 2：AI_MODEL 缺失时直接报错，不写 fallback。
//   'gpt-4o-mini' 这类「看起来合理」的默认值会把「配置没生效」伪装成
//   「模型不好用 / key 不对」，排查方向直接跑偏。
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
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  // 用 .chat() 走 Chat Completions 协议，兼容 OpenAI / DeepSeek / 通义 / OpenRouter 等
  // （默认 Responses API 仅 OpenAI 官方支持，国内服务商不支持）
  return provider.chat(modelId);
}
