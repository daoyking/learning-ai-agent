// server/rag-stage2b.ts — 阶段二b「子问题拆解 + 严格引用作答」
//
// 针对阶段二（重排 + 自分解作答）的回归根因做的修正：
//   阶段二的「先列子要点再自由作答」提示诱导模型过度生成，忠实率从 90% 跌到 80%
//   （多跳 70%→40%）。本版本去掉自由生成，改为「强制逐条引用片段编号」的硬约束——
//   每条断言必须对应某个 [n] 片段，资料未提及的子问题必须写「知识库中未提及」，
//   从而在不牺牲覆盖度的前提下把忠实率拉回高位，并借子问题拆解改善多跳要点覆盖。
//
// 检索后端仍复用 server/rag.ts（TF-hash 离线向量），与阶段一/二保持同一检索底座，
// 使「检索命中率」在三次评测间可比。不再做 LLM 重排（阶段二已证其为无效改动）。

import 'dotenv/config';
import {retrieve} from './rag.js';
import {ensureIndexed} from './rag-baseline.js';
import {generateWithRetry} from './llm-retry.js';

export interface RagAnswer {
  answer: string;
  sources: string[];
  chunks: {source: string; text: string; score: number}[];
}

/**
 * 阶段二b 链：拆分子问题 → 严格引用作答（每断言对应 [n] 片段）→ 综合。
 */
export async function answerWithRagStage2b(
  query: string,
  topK = 3,
): Promise<RagAnswer> {
  await ensureIndexed();
  const chunks = await retrieve(query, topK);
  const ctx = chunks
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.text}`)
    .join('\n\n');

  // 1) 拆分子问题（轻量，短输出）
  const decSys =
    '你是 RAG 问答的查询分析器。把用户问题拆成 2-4 个必须回答的子问题（中文，每行一个，不要编号外的其它字符）。';
  const decText = await generateWithRetry({
    system: decSys,
    prompt: `用户问题：${query}`,
    maxTokens: 200,
  });
  const subQs = decText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) 严格引用作答 + 综合（硬约束：每条断言必须对应 [n] 片段）
  const ansSys =
    '你是基于本地知识库的问答助手。按以下步骤作答：\n' +
    '1) 先列出要回答的子问题。\n' +
    '2) 逐条基于【参考资料】回答每个子问题，每条必须注明引用片段编号（如「[1] ...」）；' +
    '若某子问题在资料中未提及，必须写「知识库中未提及」。\n' +
    '3) 最后用 1-2 句综合结论。\n' +
    '严禁编造资料外信息——所有断言必须能对应到某个 [n] 片段。';
  const ansPrompt =
    `用户问题：${query}\n\n需覆盖的子问题：\n` +
    `${subQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n参考资料：\n${ctx}`;
  const answer = await generateWithRetry({
    system: ansSys,
    prompt: ansPrompt,
    maxTokens: 1024,
  });

  return {
    answer,
    sources: [...new Set(chunks.map((c) => c.source))],
    chunks,
  };
}
