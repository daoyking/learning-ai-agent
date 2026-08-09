// CLI 入口：tsx src/cli.ts  → 跑真实 LLM 评测并写出 eval-report.md
// 与 runEval.ts 分离，避免顶层 await 使 runEval 成为 async 模块、影响被其他工程 import。
import { writeFileSync } from 'node:fs';
import { runEval, renderEvalReport } from './runEval.js';

const report = await runEval();
const md = renderEvalReport(report);
writeFileSync('eval-report.md', md);
console.log(md);
