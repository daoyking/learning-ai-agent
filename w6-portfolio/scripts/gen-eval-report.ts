import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, type EvalCase, type Criterion } from '../../w5-agent-eval/src/dataset.js';

// 说明：本脚本只依赖 dataset（不引入 ai SDK），离线安全运行。
// 它复用了 w5 评测管线的核心逻辑（与 src/runEval.ts 同构），用 mock judge/agent 生成「格式示例」报告。

interface CriterionResult {
  score: number;
  passed: boolean;
  reasoning: string;
}
type JudgeFn = (args: { criterion: string; agentOutput: string; context?: string }) => Promise<CriterionResult>;

const mockAgent = async (input: string) => ({
  text: `（离线示例 Agent 输出）针对输入「${input.slice(0, 36)}${input.length > 36 ? '…' : ''}」，Agent 规划后调用了对应工具并给出结论，包含工具结果与自然语言解释。`,
  toolCalls: [{ name: 'calculator', args: {}, result: '84' }],
});

const mockJudge: JudgeFn = async ({ criterion, agentOutput }) => {
  const len = agentOutput?.length ?? 0;
  const score = Math.min(10, 6 + (len > 0 ? 2 : 0) + (criterion.length % 3));
  return {
    score,
    passed: score >= 6,
    reasoning:
      '（离线示例）mock judge 固定启发式打分，非真实 LLM 评审。配置 OPENAI_API_KEY 后运行 `npm run eval`（w5-agent-eval）可生成真实评测报告。',
  };
};

interface CaseResult {
  id: string;
  output: string;
  toolCalls: number;
  criteria: (CriterionResult & { name: string })[];
  caseScore: number;
  passed: boolean;
}

async function runEvalLocal(dataset: EvalCase[]) {
  const cases: CaseResult[] = [];
  for (const c of dataset) {
    const run = await mockAgent(c.input);
    const criteria: (CriterionResult & { name: string })[] = [];
    let weightSum = 0;
    let weighted = 0;
    for (const crit of c.criteria) {
      const w = crit.weight ?? 1;
      const r = await mockJudge({ criterion: crit.description, agentOutput: run.text, context: c.context });
      criteria.push({ ...r, name: crit.name });
      weightSum += w;
      weighted += r.score * w;
    }
    cases.push({
      id: c.id,
      output: run.text,
      toolCalls: run.toolCalls.length,
      criteria,
      caseScore: weightSum ? Number((weighted / weightSum).toFixed(2)) : 0,
      passed: criteria.every((x) => x.passed),
    });
  }
  const total = cases.length;
  const passedCount = cases.filter((c) => c.passed).length;
  const weightedScore = total ? Number((cases.reduce((a, c) => a + c.caseScore, 0) / total).toFixed(2)) : 0;
  return { total, passRate: total ? passedCount / total : 0, weightedScore, cases };
}

function render(report: ReturnType<Awaited<typeof runEvalLocal> extends infer T ? T : never>): string {
  return (
    `# Eval 报告\n\n` +
    `- 用例数：${report.total}\n- 通过率：${(report.passRate * 100).toFixed(0)}%\n- 加权均分：${report.weightedScore}/10\n\n` +
    report.cases
      .map(
        (c) =>
          `### ${c.id} · 得分 ${c.caseScore} ${c.passed ? '✅' : '❌'}（工具调用 ${c.toolCalls} 次）\n` +
          c.criteria.map((x) => `- ${x.name}: ${x.score}/10 ${x.passed ? '✅' : '❌'} — ${x.reasoning}`).join('\n'),
      )
      .join('\n\n')
  );
}

const dir = fileURLToPath(new URL('.', import.meta.url));
const dataset = loadDataset();
const report = await runEvalLocal(dataset);

const md =
  `# Eval 报告（离线示例）\n\n` +
  `> ⚠️ **本文件由 w5 评测管线的同构逻辑生成，但使用了零依赖 mock judge / mock agent**。评分为示例值，仅用于展示报告格式与管线串联。\n` +
  `> 真实评测：在 \`w5-agent-eval\` 目录配置 \`OPENAI_API_KEY\` 后运行 \`npm run eval\` 即可生成真实打分报告。\n\n` +
  render(report).replace(/^# Eval 报告\n\n/, '') +
  `\n\n---\n\n## 本地 Tracer 时间线（等价 Langfuse 接收内容）\n\n` +
  `运行 \`npm run demo\`（w5-agent-eval）会输出如下结构的 trace；配置 \`LANGFUSE_PUBLIC_KEY/SECRET_KEY\` 后，\n` +
  `同一份 span 树会自动 flush 到 Langfuse（trace 名 \`agent-eval\`，\`model:\` 前缀 span 映射为 generation）。\n\n` +
  `| # | Span | 父级 | 耗时(ms) |\n|---|---|---|---|\n` +
  `| 1 | agent:run | — | 63 |\n` +
  `| 2 | retrieve | agent:run | 21 |\n` +
  `| 3 | tool:calculator | agent:run | 11 |\n` +
  `| 4 | model:generate | agent:run | 31 |\n\n` +
  `**总 span 数**：4 · **累计耗时**：126ms\n`;

writeFileSync(resolve(dir, '../eval-report.md'), md);
console.log('wrote', resolve(dir, '../eval-report.md'));
console.log('weightedScore', report.weightedScore, 'passRate', report.passRate);
