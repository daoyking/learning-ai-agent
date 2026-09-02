// 环境变量必须显式加载：tsx 不会自动读 .env。
// 只在入口文件写 import 'dotenv/config' 极易漏——本工程 npm start 走 index.ts，
// 而 npm run eval 走 src/cli.ts，是两个入口，后者就漏过一次，
// 结果 AI_MODEL 静默回落到 deepseek-chat、连到错误的端点，很难查。
// 放在这里，任何 import 链经过 model.ts 的入口都会自动加载。
import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';

// 与 W2/W4 一致：用 createOpenAI().chat() 走 Chat Completions，
// 兼容 DeepSeek / 通义 / OpenRouter 等任意 OpenAI 兼容端点。
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'missing',
  baseURL: process.env.OPENAI_BASE_URL,
});

const modelId = process.env.AI_MODEL;

if (!modelId || !process.env.OPENAI_BASE_URL) {
  // 不抛错：离线单测会经 runEval → judge → model 加载本模块，抛错会连测试一起挂掉。
  console.warn(
    '⚠️  模型环境变量未就绪：' +
      `AI_MODEL=${modelId ?? '(未设置)'}  OPENAI_BASE_URL=${process.env.OPENAI_BASE_URL ?? '(未设置)'}\n` +
      '   请确认工程根目录下有 .env（参考 .env.example），否则会连到错误的端点。',
  );
}

export const model = provider.chat(modelId ?? 'deepseek-chat');
