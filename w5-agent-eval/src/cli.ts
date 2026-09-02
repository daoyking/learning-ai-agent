// CLI 入口：tsx src/cli.ts  → 跑真实 LLM 评测并写出 eval-report.md
// 与 runEval.ts 分离，避免顶层 await 使 runEval 成为 async 模块、影响被其他工程 import。
import { writeFileSync } from 'node:fs';
import { runEval, renderEvalReport } from './runEval.js';
import { loadDataset } from './dataset.js';

// 轻量参数解析（不引第三方依赖）：
//   --case <id>     只跑指定用例，可重复；用于快速验证单条，省去全量等待
//   --dataset <p>   指定数据集文件（相对工程根目录）
//   --out <p>       报告输出路径，默认 eval-report.md
//   --no-write      只打印不落盘
interface Options {
  cases: string[];
  dataset?: string;
  out: string;
  write: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { cases: [], out: 'eval-report.md', write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') opts.cases.push(argv[++i]);
    else if (a === '--dataset') opts.dataset = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--no-write') opts.write = false;
    else if (a?.startsWith('--case=')) opts.cases.push(a.slice('--case='.length));
    else if (a?.startsWith('--dataset=')) opts.dataset = a.slice('--dataset='.length);
    else if (a?.startsWith('--out=')) opts.out = a.slice('--out='.length);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
let dataset = loadDataset(opts.dataset);

if (opts.cases.length) {
  const wanted = new Set(opts.cases);
  const before = dataset.length;
  dataset = dataset.filter((c) => wanted.has(c.id));
  const missing = opts.cases.filter((id) => !dataset.some((c) => c.id === id));
  if (missing.length) {
    console.error(`✗ 找不到用例：${missing.join('、')}`);
    console.error(`  可用用例：${loadDataset(opts.dataset).map((c) => c.id).join('、')}`);
    process.exit(1);
  }
  console.log(`→ 只跑 ${dataset.length}/${before} 个用例：${opts.cases.join('、')}\n`);
}

const report = await runEval(undefined, undefined, dataset);
const md = renderEvalReport(report);
if (opts.write) writeFileSync(opts.out, md);
console.log(md);
if (opts.write) console.log(`\n→ 报告已写入 ${opts.out}`);
