import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from './model.js';

// 单条标准的评审结果 schema
export const judgeSchema = z.object({
  score: z.number().min(0).max(10).describe('0-10 分'),
  passed: z.boolean().describe('是否达到可用门槛（score>=7）'),
  reasoning: z.string().describe('一句话评审理由'),
});
export type CriterionResult = z.infer<typeof judgeSchema>;

export interface JudgeInput {
  criterion: string;
  agentOutput: string;
  context?: string;
}

// 可注入的评审函数：真实场景用 LLM，离线单测用确定性 mock
export type JudgeFn = (input: JudgeInput) => Promise<CriterionResult>;

export const llmJudge: JudgeFn = async ({ criterion, agentOutput, context }) => {
  const { object } = await generateObject({
    model,
    schema: judgeSchema,
    system:
      '你是严格的 AI 产品评审员。按给定标准对 Agent 输出打分（0-10），' +
      'passed=true 表示达到可用门槛（score>=7）。只输出符合 schema 的 JSON。',
    prompt:
      `评审标准：${criterion}\n` +
      (context ? `补充上下文：${context}\n\n` : '') +
      `Agent 输出：\n${agentOutput}\n\n请输出 score / passed / reasoning。`,
  });
  return object;
};
