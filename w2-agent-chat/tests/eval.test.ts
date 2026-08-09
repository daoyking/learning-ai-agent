// tests/eval.test.ts — W2 评测的 CI 回归测试（离线、零 key）
// 用 node 内置测试运行器 + tsx，无需额外装 vitest：
//   npm test  →  node --import tsx --test tests/eval.test.ts
//
// 真实 LLM 评测需要 key（见 evals/run.ts）；本测试只验证
// 「数据集结构正确 + eval 聚合逻辑正常」，保证改了 prompt/工具后 CI 能拦住回归。

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

// 离线 mock：确定性返回，证明 harness + 数据集在 CI 零 key 下可跑
const mockAgent = async (input: string): Promise<AgentRun> => ({
  text: `mock answer for: ${input}`,
  toolCalls: [{ tool: 'calculator', input: { expression: '1+1' }, output: { result: 2 } }],
});
const mockJudge = async () => ({ score: 8, passed: true, reasoning: 'mock judge' });

test('W2 评测数据集结构合法', () => {
  assert.ok(Array.isArray(dataset) && dataset.length > 0, '数据集应为非空数组');
  for (const c of dataset) {
    assert.ok(c.id && c.input, `用例 ${c.id} 缺 id/input`);
    assert.ok(Array.isArray(c.criteria) && c.criteria.length > 0, `用例 ${c.id} 缺 criteria`);
    for (const crit of c.criteria) {
      assert.ok(crit.name && crit.description, `用例 ${c.id} 的 criterion 缺 name/description`);
    }
  }
});

test('W2 runEval 离线聚合正确（CI 回归门禁）', async () => {
  const report = await runEval(mockJudge, mockAgent, dataset);
  assert.equal(report.total, dataset.length, '用例总数应一致');
  assert.ok(report.passRate >= 0 && report.passRate <= 1, '通过率应在 0-1');
  assert.ok(report.weightedScore >= 0 && report.weightedScore <= 10, '加权均分应在 0-10');
  assert.equal(report.cases.length, dataset.length, '逐例结果数应一致');
});
