import { embedMany, embed } from 'ai';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddingModel } from './embed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, 'docs');

export interface Chunk {
  id: string;
  source: string;
  text: string;
  vector: number[];
}

let chunks: Chunk[] = [];

// 朴素分块：按空行分段，单段超过 size 时按句切分，避免超大片段
function chunkText(text: string, size = 400): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && (buf + '\n' + p).length > size) {
      out.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + '\n' + p : p;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

// 启动期索引：读 docs/*.md|*.txt → 分块 → 批量向量化 → 存入内存
export async function ingest(): Promise<number> {
  const files = (await readdir(DOCS_ROOT)).filter((f) => /\.(md|txt)$/i.test(f));
  const raw = await Promise.all(
    files.map(async (f) => ({
      source: f,
      text: await readFile(resolve(DOCS_ROOT, f), 'utf-8'),
    })),
  );
  const all: { source: string; text: string }[] = [];
  raw.forEach(({ source, text }) =>
    chunkText(text).forEach((t) => all.push({ source, text })),
  );
  const model = createEmbeddingModel();
  const { embeddings } = await embedMany({ model, values: all.map((a) => a.text) });
  chunks = all.map((a, i) => ({
    id: String(i),
    source: a.source,
    text: a.text,
    vector: embeddings[i],
  }));
  return chunks.length;
}

// 余弦相似度
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 检索：把 query 向量化后，返回最相似的 topK 片段
export async function retrieve(
  query: string,
  topK = 3,
): Promise<{ source: string; text: string; score: number }[]> {
  if (!chunks.length) return [];
  const { embedding } = await embed({ model: createEmbeddingModel(), value: query });
  return chunks
    .map((c) => ({ source: c.source, text: c.text, score: cosine(embedding, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
