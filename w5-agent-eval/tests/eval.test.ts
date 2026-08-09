import { describe, it, expect } from 'vitest';
import { runEval } from '../src/runEval.js';
import { tracer } from '../src/trace.js';
import type { JudgeFn } from '../src/judge.js';
import type { AgentRun } from '../src/agent.js';

// 离线确定性 mock：每条标准都给满分，且不调用任何 LLM
const mockJudge: JudgeFn = async ({ criterion }) => ({
  score: criterion.includes('必须') ? 9 : 7,
  passed: true,
  reasoning: 'mock', // 离线测试用
});

const mockAgent = async (): Promise<AgentRun> => ({
  text: 'RAG 是检索增强生成，先检索资料再作答可降低幻觉。答案：84。',
  toolCalls: [
    { tool: 'calculator', input: { expression: '12 * (3 + 4)' }, output: { result: 84 } },
    { tool: 'searchDocs', input: { query: 'rag' }, output: { hit: 'RAG...' } },
  ],
});

describe('runEval（离线，注入 mock agent + mock judge）', () => {
  it('能对数据集逐例评分并汇总', async () => {
    const report = await runEval(mockJudge, mockAgent);
    expect(report.total).toBeGreaterThan(0);
    expect(report.cases.length).toBe(report.total);
    expect(report.passRate).toBe(1);
    expect(report.weightedScore).toBeGreaterThan(0);
  });

  it('可观测：runEval 为每个用例记录了 span', async () => {
    await runEval(mockJudge, mockAgent);
    expect(tracer.spans.length).toBeGreaterThan(0);
    // runEval 会为每个用例包一个 eval:<id> 的 span（真实 agent 还会额外包 agent:run）
    expect(tracer.spans.some((s) => s.name.startsWith('eval:'))).toBe(true);
  });
});
