import { generateText } from 'ai';
import { z } from 'zod';
import { model } from './model.js';

// 单条标准的评审结果 schema
export const judgeSchema = z.object({
  score: z.coerce.number().describe('0-10 分'),
  passed: z.boolean().describe('是否达到可用门槛（score>=7）'),
  reasoning: z.string().describe('一句话评审理由'),
});
export type CriterionResult = z.infer<typeof judgeSchema>;

export interface JudgeInput {
  criterion: string;
  agentOutput: string;
  context?: string;
  toolCalls?: string[]; // Agent 实际调用的工具名（评「是否调用工具」时以真实行为为准）
}

// 可注入的评审函数：真实场景用 LLM，离线单测用确定性 mock
export type JudgeFn = (input: JudgeInput) => Promise<CriterionResult>;

// 从模型自由文本里抽取 JSON 对象（兼容 ```json 代码块 / 前后多余文字）
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  return JSON.parse(raw.slice(start, end + 1));
}

export const llmJudge: JudgeFn = async ({ criterion, agentOutput, context, toolCalls }) => {
  const { text } = await generateText({
    model,
    system:
      '你是严格的 AI 产品评审员。按给定标准对 Agent 输出打分（0-10），' +
      'passed=true 表示达到可用门槛（score>=7）。只输出一个 JSON 对象，不要任何额外解释文字。\n' +
      // 这条是踩过坑后加的：评测「有没有调用工具」时，LLM 评审员会从「输出里看不看得出来」
      // 去反推，而不是看真实调用记录。rag-1 就因此被判 6 分——Agent 明明调了 searchDocs，
      // 评审员却以「输出未明确体现引用片段」扣分，把「行为标准」评成了「输出质量标准」。
      '重要：当评审标准是在问「是否调用了某工具/某个行为是否发生时，' +
      '必须以下面给出的「实际调用记录」为唯一事实依据，' +
      '不要因为输出文本里没提到就判定未调用，也不要据此扣输出质量的账。',
    prompt:
      `评审标准：${criterion}\n` +
      (context ? `补充上下文：${context}\n\n` : '') +
      (toolCalls && toolCalls.length
        ? `Agent 实际调用的工具（事实依据）：${toolCalls.join('、')}\n`
        : `Agent 实际未调用任何工具（事实依据）。\n`) +
      `Agent 输出：\n${agentOutput}\n\n` +
      `请严格只输出如下 JSON（不要 markdown 代码块、不要解释）：\n` +
      `{"score": <0-10 的数字>, "passed": <true 或 false>, "reasoning": "<一句话理由>"}`,
  });
  const raw = judgeSchema.parse(extractJson(text));
  // 夹取到 [0,10]，容忍模型偶发越界（如把总分满分带入单条评分）
  const score = Math.max(0, Math.min(10, Number(raw.score)));
  return { score, passed: score >= 7, reasoning: raw.reasoning };
};
