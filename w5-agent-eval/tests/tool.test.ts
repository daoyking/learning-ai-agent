import { describe, it, expect } from 'vitest';
import { safeCalc, searchKnowledge } from '../src/tools.js';

// 直接测纯函数核心（AI SDK 的 tool.execute 在 v7 返回联合类型，不便直接断言）
describe('calculator 核心（safeCalc）', () => {
  it('正确计算四则运算', () => {
    expect(safeCalc('12 * (3 + 4)')).toBe(84);
  });

  it('拒绝非法表达式（防注入）', () => {
    expect(() => safeCalc('alert(1)')).toThrow();
  });
});

describe('searchDocs 核心（searchKnowledge）', () => {
  it('检索到内置文档', () => {
    expect(searchKnowledge('rag')).toContain('RAG');
  });

  it('未知关键词返回兜底', () => {
    expect(searchKnowledge('zzz')).toContain('未找到');
  });
});
