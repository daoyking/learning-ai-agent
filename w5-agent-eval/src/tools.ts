import { tool } from 'ai';
import { z } from 'zod';

// 安全四则运算：仅允许数字与 + - * / ( ) 与空格，杜绝代码注入
export function safeCalc(expression: string): number {
  const cleaned = expression.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
    throw new Error(`非法表达式（仅允许数字与 + - * / ( )）：${expression}`);
  }
  // 白名单已过滤，表达式不含任何标识符，可安全求值
  const value = Function(`"use strict"; return (${cleaned});`)() as number;
  return value;
}

export const calculator = tool({
  description: '对数学表达式求值，例如 "12 * (3 + 4)"。仅支持 + - * / 与括号。',
  inputSchema: z.object({ expression: z.string().describe('数学表达式') }),
  execute: async ({ expression }) => {
    const result = safeCalc(expression);
    return { expression, result };
  },
});

// 文档检索（mock）：演示「检索即工具」，真实场景可换成向量库查询
const DOCS: Record<string, string> = {
  rca: 'RCA（根本原因分析）是一种定位故障根因的结构化方法，常用 5-Why 与鱼骨图。',
  rag: 'RAG（检索增强生成）先检索相关资料再让 LLM 基于资料作答，可降低幻觉。',
  agent: 'Agent 是能感知环境、调用工具、自主完成目标的系统，核心是思考-行动-观察循环。',
};

// 纯检索函数（可单测），工具只是它的薄封装
export function searchKnowledge(query: string): string {
  const key = query.trim().toLowerCase();
  return DOCS[key] ?? '未找到相关文档。';
}

export const searchDocs = tool({
  description: '按关键词检索内置知识库，返回相关片段。关键词可选：rca / rag / agent。',
  inputSchema: z.object({ query: z.string().describe('检索关键词') }),
  execute: async ({ query }) => {
    const hit = searchKnowledge(query);
    return { query, hit };
  },
});
