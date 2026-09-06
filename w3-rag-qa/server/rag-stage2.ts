// server/rag-stage2.ts — 阶段二「检索重排 + 自分解作答」链
//
// 相对阶段一（rag-baseline.ts：检索→单次生成）的两处增强，专门攻击基线最弱项
// 「多跳正确率 30%」：
//   1) 重排：多取 topK*3 候选，交由 LLM 按相关度重排回 topK，让生成看到更相关的片段
//      （缓解 TF-hash 词面匹配对多跳/长问的召回偏差）。
//   2) 自分解作答：要求模型先列出必须覆盖的 2-4 个子要点，再逐条基于资料作答，
//      强制覆盖期望要点、减少「答了但漏点」导致的 correct=false。
//
// 检索后端仍复用 server/rag.ts（TF-hash 离线向量），与阶段一保持同一检索底座，
// 使「检索命中率」在两次评测间可比；阶段二的变化集中在「重排 + 作答策略」。

import 'dotenv/config';
import {retrieve} from './rag.js';
import {ensureIndexed} from './rag-baseline.js';
import {generateWithRetry} from './llm-retry.js';

export interface RagAnswer {
  answer: string;
  /** topK 检索命中的来源文件名（去重）。 */
  sources: string[];
  /** 拼进上下文的片段（已重排）。 */
  chunks: {source: string; text: string; score: number}[];
}

/**
 * 阶段二链：检索候选 → LLM 重排 → 自分解作答。
 */
export async function answerWithRagStage2(
  query: string,
  topK = 3,
): Promise<RagAnswer> {
  await ensureIndexed();

  // 1) 多取候选，交给 LLM 重排
  const candidates = await retrieve(query, topK * 3);
  const candCtx = candidates
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.text}`)
    .join('\n\n');

  const rerankSys =
    '你是 RAG 检索重排器。给定用户问题与若干候选片段，按「与问题相关度」从高到低重排，' +
    '只输出重排后的片段编号（如 `3 1 2`），用空格分隔，不要任何解释。';
  const rerankText = await generateWithRetry({
    system: rerankSys,
    prompt: `用户问题：${query}\n\n候选片段：\n${candCtx}`,
    maxTokens: 64,
  });
  const order = rerankText
    .split(/\s+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= candidates.length);
  const ranked = order.length
    ? order.map((i) => candidates[i - 1])
    : candidates.slice(0, topK);
  const chunks = ranked.slice(0, topK);

  const ctx = chunks
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.text}`)
    .join('\n\n');

  // 2) 自分解要点 + 作答
  const ansSys =
    '你是基于本地知识库的问答助手。先列出回答此问题必须覆盖的 2-4 个子要点，' +
    '再逐条基于参考资料作答并注明来源文件名。若资料未提及某要点，必须明确说「知识库中未提及」。' +
    '严禁编造资料外信息。回答用中文。';
  const answer = await generateWithRetry({
    system: ansSys,
    prompt: `用户问题：${query}\n\n参考资料：\n${ctx}`,
    maxTokens: 1024,
  });

  return {
    answer,
    sources: [...new Set(chunks.map((c) => c.source))],
    chunks,
  };
}
