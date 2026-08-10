// evals/agent.ts — W4 工程的「可评测 Agent 适配器」
// 复用 W4 真实的 Mastra 多步编排 Agent（resumeScorer）：它内部会
// readResume → readJobDescription → 多维度打分 → 给建议。
// 把 Mastra 的 generate 结果包成 w5 期望的 AgentRun，交给 runEval 评测。

import { resumeScorer } from '../agents/resumeScorer.js';
import type { AgentRun, AgentToolCall } from '../../w5-agent-eval/src/agent.js';

export async function agent(input: string): Promise<AgentRun> {
  const res = (await resumeScorer.generate(input)) as any;
  const text: string = res?.text ?? '';
  // Mastra 的 toolCalls 为 { type: 'tool-call', payload: { toolName, args, ... } }
  const toolCalls: AgentToolCall[] = (res?.toolCalls ?? [])
    .filter((tc: any) => tc?.type === 'tool-call')
    .map((tc: any) => ({
      tool: tc?.payload?.toolName ?? tc?.toolName ?? tc?.name ?? 'tool',
      input: tc?.payload?.args ?? tc?.input ?? {},
      output: tc?.payload?.output ?? tc?.output,
    }));
  return { text, toolCalls };
}
