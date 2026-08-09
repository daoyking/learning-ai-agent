import { tool } from 'ai';
import { z } from 'zod';
import { retrieve } from './rag.js';

// RAG 的核心：把「检索」封装成一个工具，模型自主决定何时调用
export const tools = {
  retrieve: tool({
    description:
      '从本地知识库（server/docs 下的文档）中检索与用户问题最相关的片段。' +
      '当用户的问题需要基于知识库内容回答时，先调用本工具获取引用材料，再据此作答并注明来源。',
    inputSchema: z.object({
      query: z.string().describe('用于检索的查询语句，提炼用户问题的核心意图'),
    }),
    execute: async ({ query }) => {
      const results = await retrieve(query, 3);
      if (!results.length) {
        return { error: '知识库为空或未成功索引，请先确认文档已就绪' };
      }
      return {
        count: results.length,
        results: results.map((r) => ({
          source: r.source,
          score: Number(r.score.toFixed(3)),
          text: r.text.slice(0, 600),
        })),
      };
    },
  }),

  // —— 真实工具：抓取网页作为知识源（无需额外 API key，走 Node 全局 fetch）——
  fetchUrl: tool({
    description:
      '抓取一个网页 URL 并返回其纯文本正文（已去标签并截断）。' +
      '当本地知识库不足以回答、或用户明确给出网页链接时，可用它取实时网络内容，' +
      '作答时请注明 [来源: URL]。',
    inputSchema: z.object({
      url: z.string().url().describe('要抓取的网页地址，例如 https://example.com'),
    }),
    execute: async ({ url }) => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (learning-agent-demo)' },
        });
        if (!resp.ok) return { error: `HTTP ${resp.status} ${resp.statusText}` };
        const html = await resp.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        return { url, chars: text.length, text };
      } catch (e) {
        return { error: `抓取失败：${(e as Error).message}` };
      }
    },
  }),
};
