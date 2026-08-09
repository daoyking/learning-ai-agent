import { streamText } from 'ai';
import { calculator, searchDocs } from './tools.js';
import { model } from './model.js';
import { tracer } from './trace.js';

export interface AgentToolCall {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface AgentRun {
  text: string;
  toolCalls: AgentToolCall[];
}

export async function runAgent(prompt: string): Promise<AgentRun> {
  return tracer.span('agent:run', async () => {
    const toolCalls: AgentToolCall[] = [];

    const result = streamText({
      model,
      system:
        '你是一个能调用工具的助手。需要计算时用 calculator，需要查资料时用 searchDocs。' +
        '先用中文简短说明思路，再给出最终答案。',
      prompt,
      tools: { calculator, searchDocs },
      // 可观测性：开启 AI SDK 原生 telemetry。
      // 有 OpenTelemetry SDK 时导出到 collector；无 SDK 时自动 no-op，不会报错。
      telemetry: {
        isEnabled: true,
        functionId: 'w5-demo-agent',
      },
      onStepFinish: (step) => {
        for (const tc of step.toolCalls ?? []) {
          const output = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
          toolCalls.push({ tool: tc.toolName, input: tc.input, output: output?.output });
          tracer.event('tool-call', { tool: tc.toolName, input: tc.input });
        }
      },
    });

    let text = '';
    for await (const delta of result.textStream) {
      text += delta;
    }
    tracer.event('model-output', { chars: text.length });
    return { text, toolCalls };
  });
}
