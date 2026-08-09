import { tool } from 'ai';
import { z } from 'zod';

export const tools = {
  getCurrentTime: tool({
    description: '获取当前的日期和时间（北京时间）',
    // 关键（v7）：inputSchema 不是 parameters
    inputSchema: z.object({}),
    execute: async () => ({
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    }),
  }),

  calculator: tool({
    description: '计算一个算术表达式，例如 "12 * (3 + 4)"',
    inputSchema: z.object({
      expression: z.string().describe('算术表达式，仅含数字与 + - * / ( )'),
    }),
    execute: async ({ expression }) => {
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return { error: '仅支持数字与 + - * / ( )' };
      }
      try {
        // eslint-disable-next-line no-new-func
        const val = new Function(`"use strict"; return (${expression});`)();
        return typeof val === 'number' && Number.isFinite(val)
          ? { expression, result: val }
          : { error: '计算失败' };
      } catch {
        return { error: '计算失败' };
      }
    },
  }),
};
