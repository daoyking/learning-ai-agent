// evals/agent.ts — W2 工程的「可评测 Agent 适配器」
// 复用 W2 真实的工具（calculator / getWeather / readFile / fetchUrl / getCurrentTime）
// 与模型，把一次对话跑成无头（headless）的 AgentRun，交给 w5 的 runEval 评测。
// 这样评测的就是「W2 这个工程本身的能力」，而非另写一份假逻辑。

import { streamText, generateText, stepCountIs } from 'ai';
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
    // v5+ 起必须显式声明 stopWhen：默认只跑一步，模型一返回工具调用就结束。
    // 旧的 v4 写法 maxSteps 已被移除，且因为 evals 不在 tsconfig include 里
    // 一直没被类型检查抓到 —— 表现为「调了工具但没回答」。
    stopWhen: stepCountIs(5),
    onStepFinish: (step) => {
      for (const tc of step.toolCalls ?? []) {
        const output = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
        toolCalls.push({ tool: tc.toolName, input: tc.input, output: (output as any)?.output });
      }
    },
  });

  let text = '';
  for await (const delta of result.textStream) text += delta;

  // 兜底：仅在模型几乎没产出文本时（工具调用后只留下一句意图声明）才合成。
  // 正常流程下（stopWhen 生效）模型会自己跑完循环并输出最终答案，不会走到这里。
  // 因此这里必须打印告警：兜底一旦频繁触发，说明多步循环仍有问题，
  // 应当去排查根因，而不是让兜底把它掩盖成「看起来能用」（W5 踩过这个坑）。
  if (toolCalls.length && text.trim().length < 10) {
    console.warn('[eval-agent] ⚠️ 模型未产出有效文本，触发兜底合成 —— 请检查 stopWhen 是否生效');
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
