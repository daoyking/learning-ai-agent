// evals/agent.ts — W3 工程的「可评测 Agent 适配器」
// 复用 W3 真实的 RAG：先 ingest() 把 server/docs 索引进内存向量库，
// 再用真实的 retrieve / fetchUrl 工具跑无头 AgentRun，交给 w5 的 runEval 评测。

import { streamText } from 'ai';
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
  const result = streamText({
    model: createModel(),
    system:
      '你是一个基于本地知识库的问答助手。当用户问题需要知识库内容时，先调用 retrieve 工具取回相关片段，' +
      '再据此作答并注明来源文件名；本地库不足时可调用 fetchUrl 补充。先简要说明思路，再给答案。',
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
