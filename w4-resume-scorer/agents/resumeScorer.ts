import 'dotenv/config';
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { readResume, readJobDescription } from '../tools/resumeTools.js';

// dotenv 加载放在这里（共享模块）而不是入口文件：本工程有 index.ts 与 evals/run.ts
// 两个入口，只在其中一个写会漏掉另一条链路，导致环境变量静默为 undefined。
// AI_MODEL 缺失时直接报错而非 fallback：'gpt-4o-mini' 这类默认值会把
// 「配置没生效」伪装成「模型不好用」，排查方向直接跑偏。
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
// 用 .chat() 走 Chat Completions，兼容 DeepSeek / 通义 / OpenRouter 等
const model = provider.chat(modelId);

export const resumeScorer = new Agent({
  id: 'resume-scorer',
  name: 'resume-scorer',
  instructions: `你是资深技术招聘官，擅长评估「前端 + AI Agent」方向的候选人。

当用户要求评估时：
1. 先用 readResume 工具读取简历文本；
2. 再用 readJobDescription 工具读取目标岗位 JD；
3. 基于两者逐项打分，并给出可执行的改进建议。

打分维度（每项 0-10 分）：
1. 技术栈匹配度（React / TypeScript / Vue / Node 等）
2. 工程化与全栈交付能力
3. AI / Agent 实际经验
4. 作品集与可演示交付物
5. 表达与简历结构

输出要求：中文 Markdown，包含每个维度分数、总分（满分 50），以及 3 条最优先的改进建议。`,
  model,
  tools: { readResume, readJobDescription },
});
