// server/llm-retry.ts — 带重试的 LLM 调用封装（原生 fetch + SSE 解析）
//
// 为什么不用 AI SDK 的 generateText：
//   本地 OmniRoute / 部分 OpenAI 兼容网关在收到非流式请求时，仍固定以
//   `text/event-stream`（SSE, `data: {...}` 分片）返回，AI SDK 的 generateText
//   按 JSON 解析会直接抛 "Invalid JSON response"。这里改为原生 fetch 发
//   stream:true 并手写 SSE 解析，对 OmniRoute / Ollama / OpenRouter 等统一可用。
//
// 重试：捕获异常 + 空响应兜底，指数退避，保证批量评测能扛过瞬时抖动跑完。

import 'dotenv/config';

export interface GenerateOpts {
  system: string;
  prompt: string;
  /** 可选：覆盖默认 max_tokens（重排等短输出场景用更小值省时）。 */
  maxTokens?: number;
}

/**
 * 调用 OpenAI 兼容端点（OPENAI_BASE_URL + /chat/completions）并做最多 `maxAttempts` 次重试。
 */
export async function generateWithRetry(
  opts: GenerateOpts,
  maxAttempts = 5,
): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL || 'http://localhost:20128/v1').replace(
    /\/+$/,
    '',
  );
  const model = process.env.AI_MODEL || 'auto/best-free';
  const apiKey = process.env.OPENAI_API_KEY || 'omni';
  const url = `${base}/chat/completions`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {role: 'system', content: opts.system},
            {role: 'user', content: opts.prompt},
          ],
          max_tokens: opts.maxTokens ?? 1024,
          temperature: 0,
          stream: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const text = await consumeSSE(res);
      if (text && text.trim().length > 0) return text;
      console.warn(
        `  ⚠️ 第 ${attempt}/${maxAttempts} 次调用返回空响应，退避后重试…`,
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `  ⚠️ 第 ${attempt}/${maxAttempts} 次调用异常：${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }，退避后重试…`,
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  // 不再抛出：重试耗尽时返回空串，由调用方记为「模型空响应」失败并继续，
  // 避免单题空响应中断整轮评测（基线评测需跑完全部 50 题再出报告）。
  console.warn(
    `  ⚠️ 第 ${maxAttempts} 次重试后仍失败（${lastError instanceof Error ? lastError.message.split('\n')[0] : '空响应'}），记为空响应继续。`,
  );
  return '';
}

/** 读取 SSE 流，拼接所有 delta.content，遇到 `data: [DONE]` 结束。 */
async function consumeSSE(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += decoder.decode(value, {stream: true});
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const choice = j.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) out += choice.delta.content;
        else if (choice.message?.content && !choice.delta) out += choice.message.content;
      } catch {
        // 分片未完整时跳过，下一段补齐后重试
      }
    }
  }
  return out;
}
