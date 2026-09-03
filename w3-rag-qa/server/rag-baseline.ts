// server/rag-baseline.ts — 阶段一「最小 RAG 链」
//
// 与 evals/agent.ts 的 Agent 式（工具循环 + 多步）不同，这里是朴素的最短链路：
//   检索(retrieve, topK) → 拼上下文 → 单次 generateText 作答
// 不做重排、不做多跳规划、不做工具调用。它本身就是「基线」，后续阶段
// （重排 / 查询改写 / 多跳 / 混合检索）在它之上叠加，并用同一份 50 题评测集复跑，
// 填同一张指标表来证明「真的变好了」。
//
// 检索后端复用 server/rag.ts（默认 TF-hash 离线向量，零 key 可跑）；
// 若 .env 指向带 embedding 的本地 Ollama(bge-m3) 也可无缝替换 server/embed.ts。

import 'dotenv/config';
import {generateText} from 'ai';
import {ingest, retrieve} from './rag.js';
import {createModel} from './model.js';

let indexed = false;

/** 启动期索引一次（幂等）。 */
export async function ensureIndexed(): Promise<void> {
  if (!indexed) {
    const n = await ingest();
    indexed = true;
    console.log(`[rag-baseline] 已索引 ${n} 个片段`);
  }
}

export interface RagAnswer {
  answer: string;
  /** topK 检索命中的来源文件名（去重）。 */
  sources: string[];
  /** 拼进上下文的片段。 */
  chunks: {source: string; text: string; score: number}[];
}

/**
 * 最小 RAG 链：检索 → 拼上下文 → 单次生成。
 * 只依据检索到的片段作答，未提及则明确说「知识库中未提及」，不编造。
 */
export async function answerWithRag(query: string, topK = 3): Promise<RagAnswer> {
  await ensureIndexed();
  const chunks = await retrieve(query, topK);
  const context = chunks
    .map((c, i) => `[${i + 1}] (来源: ${c.source})\n${c.text}`)
    .join('\n\n');
  const {text} = await generateText({
    model: createModel(),
    system:
      '你是基于本地知识库的问答助手。只使用下方「参考资料」作答，严禁编造资料之外的信息。' +
      '若资料未提及该问题，必须明确说明「知识库中未提及」。回答用中文，并注明引用来源文件名。',
    prompt: `用户问题：${query}\n\n参考资料：\n${context || '（无检索结果）'}`,
  });
  return {
    answer: text,
    sources: [...new Set(chunks.map((c) => c.source))],
    chunks,
  };
}
