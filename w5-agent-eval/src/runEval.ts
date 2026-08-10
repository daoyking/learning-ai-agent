import { runAgent, type AgentRun } from './agent.js';
import { llmJudge, type JudgeFn, type CriterionResult } from './judge.js';
import { tracer } from './trace.js';
import { langfuseExporter } from './langfuse.js';
import { loadDataset, type EvalCase } from './dataset.js';

// 供 W2/W3/W4 的 evals/run.ts 直接复用 judge（它们从 runEval 里 import llmJudge）
export { llmJudge } from './judge.js';

export interface CaseResult {
  id: string;
  output: string;
  toolCalls: number;
  criteria: (CriterionResult & { name: string })[];
  caseScore: number; // 加权平均（0-10）
  passed: boolean;
}

export interface EvalReport {
  total: number;
  passRate: number; // 0-1
  weightedScore: number; // 0-10
  cases: CaseResult[];
  trace: string;
}

export type AgentFn = (input: string) => Promise<AgentRun>;

// agent / judge / dataset 均可注入：真实跑用 LLM，离线单测注入 mock
export async function runEval(
  judge: JudgeFn = llmJudge,
  agent: AgentFn = runAgent,
  dataset: EvalCase[] = loadDataset(),
): Promise<EvalReport> {
  tracer.reset();
  const cases: CaseResult[] = [];

  for (const c of dataset) {
    await tracer.span(`eval:${c.id}`, async () => {
      const run = await agent(c.input);
      const criteria: (CriterionResult & { name: string })[] = [];
      let weightSum = 0;
      let weighted = 0;
      for (const crit of c.criteria) {
        const w = crit.weight ?? 1;
        const r = await judge({
          criterion: crit.description,
          agentOutput: run.text,
          context: c.context,
          toolCalls: run.toolCalls.map((t) => t.tool),
        });
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
    });
  }

  const total = cases.length;
  const passedCount = cases.filter((c) => c.passed).length;
  const weightedScore = total
    ? Number((cases.reduce((a, c) => a + c.caseScore, 0) / total).toFixed(2))
    : 0;

  // 把本次评测的 trace 导出到 Langfuse（若配置了 key）；未配置则自动 no-op，不影响离线流程
  await langfuseExporter.flush();

  return {
    total,
    passRate: total ? passedCount / total : 0,
    weightedScore,
    cases,
    trace: tracer.report(),
  };
}

// 把评测结果渲染成 Markdown 报告（CLI 与离线生成脚本共用）
export function renderEvalReport(report: EvalReport): string {
  return (
    `# Eval 报告\n\n` +
    `- 用例数：${report.total}\n- 通过率：${(report.passRate * 100).toFixed(0)}%\n- 加权均分：${report.weightedScore}/10\n\n` +
    report.cases
      .map(
        (c) =>
          `### ${c.id} · 得分 ${c.caseScore} ${c.passed ? '✅' : '❌'} · 工具调用 ${c.toolCalls} 次\n` +
          c.criteria.map((x) => `- ${x.name}: ${x.score}/10 ${x.passed ? '✅' : '❌'} — ${x.reasoning}`).join('\n'),
      )
      .join('\n\n') +
    `\n\n${report.trace}\n`
  );
}

// CLI 入口独立文件 src/cli.ts，避免顶层 await 影响 runEval 被其他模块 import
