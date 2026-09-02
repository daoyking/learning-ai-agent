import { streamText, generateText, stepCountIs } from 'ai';
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
      // 演示用：强制模型在需要时使用工具，避免只在文本里「口述」而不实际调用
      toolChoice: 'required',
      // 多步循环：AI SDK v5+ 默认只跑一步，模型一返回工具调用就结束。
      // 不加这句，依赖「先检索再计算」这类需要多步的任务会静默退化成一步。
      // 5 是步数上限，用来兜住模型反复调用工具的死循环。
      stopWhen: stepCountIs(5),
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
    try {
      text = await result.text; // 取跨所有步骤（含工具回环后）的完整最终文本
    } catch {
      text = '';
    }

    // 兜底：部分模型在强制工具调用后只返回 tool call、不再生成文本。
    // 此时基于工具真实结果合成最终回答（真实 Agent 常见模式）。
    if (!text.trim() && toolCalls.length) {
      text = await tracer.span('agent:synthesize', async () => {
        const { text: answer } = await generateText({
          model,
          system: '你是助手。请基于已调用的工具结果，用中文给出最终回答（含简短思路与明确答案）。',
          prompt:
            `用户问题：${prompt}\n\n已调用的工具与结果：\n` +
            toolCalls
              .map((t) => `- ${t.tool}(${JSON.stringify(t.input)}) => ${JSON.stringify(t.output)}`)
              .join('\n') +
            `\n\n请据此作答。`,
        });
        return answer;
      });
    }

    tracer.event('model-output', { chars: text.length });
    return { text, toolCalls };
  });
}
