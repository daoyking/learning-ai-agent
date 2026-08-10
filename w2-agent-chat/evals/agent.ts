// evals/agent.ts — W2 工程的「可评测 Agent 适配器」
// 复用 W2 真实的工具（calculator / getWeather / readFile / fetchUrl / getCurrentTime）
// 与模型，把一次对话跑成无头（headless）的 AgentRun，交给 w5 的 runEval 评测。
// 这样评测的就是「W2 这个工程本身的能力」，而非另写一份假逻辑。

import { streamText, generateText } from 'ai';
import { tools } from '../server/tools.js';
import { createModel } from '../server/model.js';
import type { AgentRun, AgentToolCall } from '../../w5-agent-eval/src/agent.js';

export async function agent(input: string): Promise<AgentRun> {
  const toolCalls: AgentToolCall[] = [];
  const model = createModel();

  const result = streamText({
    model,
    system:
      '你是一个能调用工具的助手。需要计算时用 calculator，查询天气用 getWeather，' +
      '读取本地文档用 readFile，抓取网页用 fetchUrl，查时间用 getCurrentTime。' +
      '先用中文简短说明思路，再给出最终答案。',
    prompt: input,
    tools,
    maxSteps: 5,
    onStepFinish: (step) => {
      for (const tc of step.toolCalls ?? []) {
        const output = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
        toolCalls.push({ tool: tc.toolName, input: tc.input, output: (output as any)?.output });
      }
    },
  });

  let text = '';
  for await (const delta of result.textStream) text += delta;

  // DeepSeek 在工具调用步后通常只返回一句引导语、不会基于工具结果续写答案。
  // 只要本次实际调用了工具，就用工具结果再综合一次完整最终回答（覆盖仅含意图声明的短文本）。
  if (toolCalls.length) {
    text = (
      await generateText({
        model,
        system:
          '你是能调用工具的助手。请严格基于下方「已执行工具的结果」用中文给出完整的最终回答，' +
          '必须包含工具返回的关键数据（如计算结果、温度/天气、文档要点与来源文件名），不要只重复意图声明。',
        prompt:
          '以下是已执行工具的结果，请据此合成完整最终回答：\n' +
          toolCalls
            .map((t) => `- ${t.tool}(${JSON.stringify(t.input)}) → ${JSON.stringify(t.output)}`)
            .join('\n'),
      })
    ).text;
  }

  return { text, toolCalls };
}
