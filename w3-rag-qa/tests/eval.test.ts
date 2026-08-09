// tests/eval.test.ts — W3 评测的 CI 回归测试（离线、零 key）
// 运行：npm test  →  node --import tsx --test tests/eval.test.ts
// 只验证「数据集结构 + eval 聚合逻辑」，真实 RAG 评测见 evals/run.ts（需 key）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runEval } from '../../w5-agent-eval/src/runEval.js';
import type { AgentRun } from '../../w5-agent-eval/src/agent.js';
import type { EvalCase } from '../../w5-agent-eval/src/dataset.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'eval-dataset.json'), 'utf8'),
) as EvalCase[];

const mockAgent = async (input: string): Promise<AgentRun> => ({
  text: `mock rag answer for: ${input}`,
  toolCalls: [{ tool: 'retrieve', input: { query: input }, output: { count: 1 } }],
});
const mockJudge = async () => ({ score: 8, passed: true, reasoning: 'mock judge' });

test('W3 评测数据集结构合法', () => {
  assert.ok(Array.isArray(dataset) && dataset.length > 0);
  for (const c of dataset) {
    assert.ok(c.id && c.input);
    assert.ok(Array.isArray(c.criteria) && c.criteria.length > 0);
    for (const crit of c.criteria) assert.ok(crit.name && crit.description);
  }
});

test('W3 runEval 离线聚合正确（CI 回归门禁）', async () => {
  const report = await runEval(mockJudge, mockAgent, dataset);
  assert.equal(report.total, dataset.length);
  assert.ok(report.passRate >= 0 && report.passRate <= 1);
  assert.ok(report.weightedScore >= 0 && report.weightedScore <= 10);
  assert.equal(report.cases.length, dataset.length);
});
