// evals/baseline.ts — 阶段一「最小 RAG 链」基线评测（可复跑）
//
// 运行：npm run eval:baseline  → 产出 eval-baseline-report.md
// 复用同一份 sample/eval-baseline-50.json，后续阶段(re-rank / 查询改写 / 多跳 / 混合检索)
// 改 server/rag-baseline.ts 与 retrieve 后重跑本脚本，填同一张表即可证伪「是否真的变好」。
//
// 三类指标：
//   - 检索命中(retrievalHit)：fact/multihop 题的 goldSources 是否出现在 topK 检索来源里（0/1）
//   - 忠实度(faithful)：答案是否只基于检索到的片段、无编造（judge）
//   - 正确性(correct)：fact/multihop 关键要点是否答对；trap 是否正确指出「未提及」、不幻觉（judge）

import 'dotenv/config';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateText} from 'ai';
import {ensureIndexed, answerWithRag} from '../server/rag-baseline.js';
import {retrieve} from '../server/rag.js';
import {createModel} from '../server/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const TOPK = 3;
const dataset = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'eval-baseline-50.json'), 'utf8'),
) as Array<{
  id: string;
  category: 'fact' | 'multihop' | 'trap';
  goldSources: string[];
  input: string;
  expect: string;
}>;

interface Row {
  id: string;
  category: string;
  retrievalHit: number | null;
  faithful: boolean;
  correct: boolean;
  answer: string;
  reason: string;
}

function parseVerdict(text: string): {faithful: boolean; correct: boolean; reason: string} {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {faithful: false, correct: false, reason: text.slice(0, 200)};
  try {
    const j = JSON.parse(m[0]);
    return {
      faithful: Boolean(j.faithful),
      correct: Boolean(j.correct),
      reason: String(j.reason ?? '').slice(0, 240),
    };
  } catch {
    return {faithful: false, correct: false, reason: text.slice(0, 200)};
  }
}

async function judge(
  q: (typeof dataset)[number],
  answer: string,
  context: string,
): Promise<{faithful: boolean; correct: boolean; reason: string}> {
  const isTrap = q.category === 'trap';
  const sys = isTrap
    ? '你是严格的 RAG 评审。给定「用户问题 / 参考资料 / 模型回答」，判断模型是否编造了参考资料之外的信息。' +
      '陷阱题的正确答案是：模型应明确说明「知识库中未提及」或不给出资料外的断言。' +
      '只输出 JSON：{"faithful": boolean(回答是否完全基于参考资料、无资料外断言), "correct": boolean(陷阱题是否正确处理为未提及/未幻觉), "reason": string}'
    : '你是严格的 RAG 评审。给定「用户问题 / 期望要点 / 参考资料 / 模型回答」，判断：' +
      'faithful=回答是否完全基于参考资料、无资料外断言；correct=回答是否覆盖了期望要点且准确。' +
      '只输出 JSON：{"faithful": boolean, "correct": boolean, "reason": string}';
  const prompt =
    `用户问题：${q.input}\n` +
    (isTrap ? '' : `期望要点：${q.expect}\n`) +
    `参考资料：\n${context}\n\n模型回答：\n${answer}`;
  const {text} = await generateText({model: createModel(), system: sys, prompt});
  return parseVerdict(text);
}

async function main() {
  await ensureIndexed();
  const rows: Row[] = [];

  for (let i = 0; i < dataset.length; i++) {
    const q = dataset[i];
    const {answer, sources, chunks} = await answerWithRag(q.input, TOPK);
    const context = chunks
      .map((c, k) => `[${k + 1}] (${c.source})\n${c.text}`)
      .join('\n\n');

    // 检索命中：用 retrieve 直接取 topK 来源，看 goldSources 是否出现
    let retrievalHit: number | null = null;
    if (q.category !== 'trap') {
      const top = await retrieve(q.input, TOPK);
      const hit = q.goldSources.some((g) => top.some((t) => t.source === g));
      retrievalHit = hit ? 1 : 0;
    }

    const v = await judge(q, answer, context);
    rows.push({
      id: q.id,
      category: q.category,
      retrievalHit,
      faithful: v.faithful,
      correct: v.correct,
      answer,
      reason: v.reason,
    });
    console.log(
      `[${i + 1}/${dataset.length}] ${q.id} hit=${retrievalHit ?? '-'} faithful=${v.faithful} correct=${v.correct}`,
    );
  }

  // 汇总
  const cat = (c: string) => rows.filter((r) => r.category === c);
  const rate = (arr: Row[], f: (r: Row) => boolean | null) => {
    const valid = arr.filter((r) => f(r) !== null);
    if (!valid.length) return null;
    return valid.filter((r) => f(r)).length / valid.length;
  };
  const pct = (x: number | null) => (x === null ? 'n/a' : (x * 100).toFixed(0) + '%');

  const overallRetrieval = rate(rows, (r) => r.retrievalHit);
  const overallFaith = rate(rows, (r) => r.faithful);
  const overallCorrect = rate(rows, (r) => r.correct);

  const md =
    `# W3 RAG 阶段一基线评测报告（最小 RAG 链）\n\n` +
    `- 题数：${rows.length}（事实 ${cat('fact').length} / 多跳 ${cat('multihop').length} / 陷阱 ${cat('trap').length}）\n` +
    `- 检索命中率(precision@${TOPK})：${pct(overallRetrieval)}\n` +
    `- 忠实率：${pct(overallFaith)}\n` +
    `- 回答正确率：${pct(overallCorrect)}\n\n` +
    `## 按类别\n\n` +
    `| 类别 | 题数 | 检索命中 | 忠实率 | 正确率 |\n|---|---|---|---|---|\n` +
    `| 事实 | ${cat('fact').length} | ${pct(rate(cat('fact'), (r) => r.retrievalHit))} | ${pct(rate(cat('fact'), (r) => r.faithful))} | ${pct(rate(cat('fact'), (r) => r.correct))} |\n` +
    `| 多跳 | ${cat('multihop').length} | ${pct(rate(cat('multihop'), (r) => r.retrievalHit))} | ${pct(rate(cat('multihop'), (r) => r.faithful))} | ${pct(rate(cat('multihop'), (r) => r.correct))} |\n` +
    `| 陷阱 | ${cat('trap').length} | n/a | ${pct(rate(cat('trap'), (r) => r.faithful))} | ${pct(rate(cat('trap'), (r) => r.correct))} |\n\n` +
    `## 逐题明细\n\n` +
    `| # | id | 类别 | 检索命中 | 忠实 | 正确 | 关键理由 |\n|---|---|---|---|---|---|---|\n` +
    rows
      .map(
        (r, i) =>
          `| ${i + 1} | ${r.id} | ${r.category} | ${r.retrievalHit ?? '-'} | ${r.faithful ? '✅' : '❌'} | ${r.correct ? '✅' : '❌'} | ${r.reason.replace(/\|/g, '/')} |`,
      )
      .join('\n');

  writeFileSync(join(here, '..', 'eval-baseline-report.md'), md);
  console.log('\n=== 汇总 ===');
  console.log(md.split('\n').slice(0, 8).join('\n'));
  console.log(`\n报告已写入 eval-baseline-report.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
