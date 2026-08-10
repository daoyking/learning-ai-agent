// evals/agent.ts — W3 工程的「可评测 Agent 适配器」
// 复用 W3 真实的 RAG：先 ingest() 把 server/docs 索引进内存向量库，
// 再用真实的 retrieve / fetchUrl 工具跑无头 AgentRun，交给 w5 的 runEval 评测。

import { streamText, generateText } from 'ai';
import { tools } from '../server/tools.js';
import { ingest } from '../server/rag.js';
import { createModel } from '../server/model.js';
import type { AgentRun, AgentToolCall } from '../../w5-agent-eval/src/agent.js';

let indexed = false;

export async function agent(input: string): Promise<AgentRun> {
  // 启动期索引一次（真实评测时才执行；离线 CI 用 mock，不触发）
  if (!indexed) {
    await ingest();
    indexed = true;
  }

  const toolCalls: AgentToolCall[] = [];
  const model = createModel();
  const result = streamText({
    model,
    system:
      '你是一个基于本地知识库的问答助手。当用户问题需要知识库内容时，先调用 retrieve 工具取回相关片段，' +
      '再据此作答并注明来源文件名；本地库不足时可调用 fetchUrl 补充。先简要说明思路，再给答案。',
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
          '你是基于本地知识库的问答助手。请严格基于下方「已执行工具的结果」用中文给出完整的最终回答，' +
          '必须包含检索到的关键内容并注明来源文件名，不要只重复意图声明。',
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
