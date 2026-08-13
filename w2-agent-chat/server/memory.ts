/**
 * memory.ts — W2 的长期记忆模块
 * 后端对接本机 agentmemory 记忆服务（REST API，默认 http://localhost:3111）
 * 记忆服务独立运行：AGENTMEMORY_DATA_DIR=<项目>/.agentmemory npx -y @agentmemory/agentmemory
 */
import 'dotenv/config';

const AM_URL = process.env.AGENTMEMORY_URL ?? 'http://localhost:3111';
const AM_TIMEOUT = Number(process.env.AGENTMEMORY_TIMEOUT ?? 5000);

async function call(path: string, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AM_TIMEOUT);
  try {
    const res = await fetch(`${AM_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      throw new Error(`agentmemory ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** 记忆服务是否可用（健康检查，不抛错） */
export async function isMemoryAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${AM_URL}/agentmemory/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** 保存一条长期记忆（用户偏好/事实/约定等） */
export async function remember(content: string, extra?: { type?: string; ttlDays?: number }): Promise<unknown> {
  return call('/agentmemory/remember', { content, ...extra });
}

/** 混合检索：根据当前问题召回相关记忆，返回记忆文本列表 */
export async function smartSearch(query: string, limit = 5): Promise<string[]> {
  const data = (await call('/agentmemory/smart-search', { query, limit })) as Record<string, unknown>;
  // 兼容不同返回结构：matches / results / memories 等
  const items: unknown[] =
    (Array.isArray(data?.matches) && (data.matches as unknown[])) ||
    (Array.isArray(data?.results) && (data.results as unknown[])) ||
    (Array.isArray(data?.memories) && (data.memories as unknown[])) ||
    [];
  return items
    .map((it) => {
      const o = it as Record<string, unknown>;
      return (o?.content ?? o?.text ?? o?.memory ?? o?.title ?? '') as string;
    })
    .filter((s) => typeof s === 'string' && s.trim().length > 0);
}

/**
 * 召回上下文：把与当前问题相关的记忆拼成一段可注入 system 的文本
 */
export async function buildMemoryContext(userQuery: string): Promise<string> {
  const hits = await smartSearch(userQuery, 5);
  if (hits.length === 0) return '';
  return (
    '以下是这个用户过去对话中与本次问题相关的记忆（供参考，不要凭空编造）：\n' +
    hits.map((h, i) => `${i + 1}. ${h}`).join('\n')
  );
}
