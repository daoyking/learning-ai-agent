// evals/run.ts — 用 w5 的 runEval 对 W3 工程做「真实 LLM 评测」
// 前置：在 w3-rag-qa/.env 填好 key（含 Embedding 模型，默认 OpenAI text-embedding-3-small）
// 运行：npm run eval  → 产出 eval-report.md

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runEval, llmJudge } from '../../w5-agent-eval/src/runEval.js';
import type { EvalCase } from '../../w5-agent-eval/src/dataset.js';
import { agent } from './agent.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'eval-dataset.json'), 'utf8'),
) as EvalCase[];

const report = await runEval(llmJudge, agent, dataset);

const md =
  `# W3 RAG 评测报告\n\n` +
  `- 用例数：${report.total}\n- 通过率：${(report.passRate * 100).toFixed(0)}%\n- 加权均分：${report.weightedScore}/10\n\n` +
  report.cases
    .map(
      (c) =>
        `### ${c.id} · 得分 ${c.caseScore} ${c.passed ? '✅' : '❌'}\n` +
        c.criteria.map((x) => `- ${x.name}: ${x.score}/10 ${x.passed ? '✅' : '❌'} — ${x.reasoning}`).join('\n'),
    )
    .join('\n\n') +
  `\n\n${report.trace}\n`;

writeFileSync(join(here, '..', 'eval-report.md'), md);
console.log(md);
