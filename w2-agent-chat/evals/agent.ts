// evals/agent.ts — W2 工程的「可评测 Agent 适配器」
// 复用 W2 真实的工具（calculator / getWeather / readFile / fetchUrl / getCurrentTime）
// 与模型，把一次对话跑成无头（headless）的 AgentRun，交给 w5 的 runEval 评测。
// 这样评测的就是「W2 这个工程本身的能力」，而非另写一份假逻辑。

import { streamText } from 'ai';
import { tools } from '../server/tools.js';
import { createModel } from '../server/model.js';
import type { AgentRun, AgentToolCall } from '../../w5-agent-eval/src/agent.js';

export async function agent(input: string): Promise<AgentRun> {
  const toolCalls: AgentToolCall[] = [];

  const result = streamText({
    model: createModel(),
    system:
      '你是一个能调用工具的助手。需要计算时用 calculator，查询天气用 getWeather，' +
      '读取本地文档用 readFile，抓取网页用 fetchUrl，查时间用 getCurrentTime。' +
      '先用中文简短说明思路，再给出最终答案。',
    prompt: input,
    tools,
    onStepFinish: (step) => {
      for (const tc of step.toolCalls ?? []) {
        const output = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
        toolCalls.push({ tool: tc.toolName, input: tc.input, output: (output as any)?.output });
      }
    },
  });

  let text = '';
  for await (const delta of result.textStream) text += delta;
  return { text, toolCalls };
}
