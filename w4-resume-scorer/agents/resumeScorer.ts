import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { readResume, readJobDescription } from '../tools/resumeTools.js';

const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'missing',
  baseURL: process.env.OPENAI_BASE_URL,
});
// 用 .chat() 走 Chat Completions，兼容 DeepSeek / 通义 / OpenRouter 等
const model = provider.chat(process.env.AI_MODEL ?? 'gpt-4o-mini');

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
