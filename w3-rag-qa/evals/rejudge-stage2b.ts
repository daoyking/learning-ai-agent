// evals/rejudge-stage2b.ts — 仅对阶段二b 中「评审判定失败（模型回显 prompt 而非返回 JSON）」的行
// 用硬化后的 judge（最多重试 3 次）重新判定，沿用已生成的回答，得到干净指标。
//
// 背景：阶段二b 首次跑用了未硬化的 judge，`auto/best-free` 在 9/50 题上回显了评测 prompt 而非返回 JSON，
// 被 parseVerdict 误记为 faithful=false/correct=false，污染了指标。本脚本只重判这 9 行（约 9~18 分钟），
// 不重新生成回答，跑完后再执行 `RAG_CHAIN=stage2b ./node_modules/.bin/tsx evals/baseline.ts`
// （所有行已在 checkpoint，跳过 LLM）即可生成去噪后的 eval-stage2b-report.md。

import 'dotenv/config';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {retrieve} from '../server/rag.js';
import {ensureIndexed} from '../server/rag-baseline.js';
import {generateWithRetry} from '../server/llm-retry.js';

const here = dirname(fileURLToPath(import.meta.url));
const TOPK = 3;
const dataset = JSON.parse(
  readFileSync(join(here, '..', 'sample', 'eval-baseline-50.json'), 'utf8'),
) as Array<{id: string; category: 'fact' | 'multihop' | 'trap'; input: string; expect: string}>;

const CK = join(here, '..', 'eval-stage2b-checkpoint.json');
const ck = JSON.parse(readFileSync(CK, 'utf8')) as {
  order: string[];
  rows: Record<string, {id: string; category: string; retrievalHit: number | null; faithful: boolean; correct: boolean; answer: string; reason: string}>;
};

// 阶段二b 首次跑里判定失败的标记：reason 直接以 judge prompt 开头（模型回显而非 JSON）
const DEG = /The user wants me to evaluate|The user is asking me to evaluate|First, let's analyze|I need to output a JSON|I need to check if the model/;

function parseVerdict(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {parsed: false, faithful: false, correct: false, reason: text.slice(0, 200)};
  try {
    const j = JSON.parse(m[0]);
    return {parsed: true, faithful: Boolean(j.faithful), correct: Boolean(j.correct), reason: String(j.reason ?? '').slice(0, 240)};
  } catch {
    return {parsed: false, faithful: false, correct: false, reason: text.slice(0, 200)};
  }
}

async function judge(q: (typeof dataset)[number], answer: string, context: string) {
  const isTrap = q.category === 'trap';
  const sys = isTrap
    ? '你是严格的 RAG 评审。给定「用户问题 / 参考资料 / 模型回答」，判断模型是否编造了参考资料之外的信息。' +
      '陷阱题的正确答案是：模型应明确说明「知识库中未提及」或不给出资料外的断言。' +
      '只输出 JSON：{"faithful": boolean, "correct": boolean, "reason": string}'
    : '你是严格的 RAG 评审。给定「用户问题 / 期望要点 / 参考资料 / 模型回答」，判断：' +
      'faithful=回答是否完全基于参考资料、无资料外断言；correct=回答是否覆盖了期望要点且准确。' +
      '只输出 JSON：{"faithful": boolean, "correct": boolean, "reason": string}';
  const prompt =
    `用户问题：${q.input}\n` + (isTrap ? '' : `期望要点：${q.expect}\n`) + `参考资料：\n${context}\n\n模型回答：\n${answer}`;
  let v = {parsed: false, faithful: false, correct: false, reason: ''};
  for (let attempt = 1; attempt <= 3; attempt++) {
    const text = await generateWithRetry({system: sys, prompt, maxTokens: 256});
    v = parseVerdict(text);
    if (v.parsed) break;
  }
  return v;
}

async function main() {
  await ensureIndexed();
  let fixed = 0;
  for (const q of dataset) {
    const row = ck.rows[q.id];
    if (!row) continue;
    if (!DEG.test(row.reason)) continue; // 仅重判判定失败的行
    const chunks = await retrieve(q.input, TOPK);
    const context = chunks.map((c, k) => `[${k + 1}] (${c.source})\n${c.text}`).join('\n\n');
    const v = await judge(q, row.answer, context);
    row.faithful = v.faithful;
    row.correct = v.correct;
    row.reason = v.reason;
    fixed++;
    console.log(`[重判] ${q.id} (${q.category}) → faithful=${v.faithful} correct=${v.correct}`);
  }
  writeFileSync(CK, JSON.stringify(ck, null, 2));
  console.log(`\n重判完成 ${fixed} 行，checkpoint 已更新。下一步执行：
  RAG_CHAIN=stage2b ./node_modules/.bin/tsx evals/baseline.ts
（所有行已在 checkpoint，跳过 LLM）生成去噪后的 eval-stage2b-report.md。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
