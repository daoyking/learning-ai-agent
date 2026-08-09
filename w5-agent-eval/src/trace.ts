// trace.ts — 轻量自建 Tracer（零依赖，离线可跑）
// 作用：把 Agent 一次运行的「模型调用 / 工具调用 / 各阶段」记录成 span，
// 形成可观测的时间线 + 汇总，相当于 LangSmith / Langfuse 的 trace 的迷你离线版。
// 真实生产可把同样的结构对接 OpenTelemetry，由 OTLP 导出到 Langfuse / Jaeger。

export interface SpanEvent {
  at: number;
  name: string;
  attributes?: Record<string, unknown>;
}

export interface Span {
  id: string;
  name: string;
  parentId: string | null;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export class Tracer {
  readonly spans: Span[] = [];
  private active: Span | null = null;
  private seq = 0;

  /** 包裹一段逻辑，记录其耗时与嵌套关系（支持父/子 span） */
  async span<T>(name: string, fn: () => Promise<T>, attributes: Record<string, unknown> = {}): Promise<T> {
    const span: Span = {
      id: `span_${++this.seq}`,
      name,
      parentId: this.active?.id ?? null,
      startTime: Date.now(),
      endTime: null,
      durationMs: null,
      attributes,
      events: [],
    };
    this.spans.push(span);
    const prev = this.active;
    this.active = span;
    try {
      return await fn();
    } finally {
      span.endTime = Date.now();
      span.durationMs = span.endTime - span.startTime;
      this.active = prev;
    }
  }

  /** 在「当前 span」内打一个时间点事件（如工具返回、token 数） */
  event(name: string, attributes?: Record<string, unknown>): void {
    if (this.active) this.active.events.push({ at: Date.now(), name, attributes });
  }

  get current(): Span | null {
    return this.active;
  }

  /** 导出 Markdown 时间线报告 */
  report(): string {
    const lines: string[] = [];
    lines.push('## 🔭 Trace 时间线');
    lines.push('');
    lines.push('| # | Span | 父级 | 耗时(ms) | 关键属性 |');
    lines.push('|---|---|---|---|---|');
    this.spans.forEach((s, i) => {
      const parent = s.parentId ?? '—';
      const dur = s.durationMs !== null ? String(s.durationMs) : '…';
      const attrs = Object.entries(s.attributes)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' · ');
      lines.push(`| ${i + 1} | ${s.name} | ${parent} | ${dur} | ${attrs || '—'} |`);
    });
    const total = this.spans.reduce((a, s) => a + (s.durationMs ?? 0), 0);
    lines.push('');
    lines.push(`**总 span 数**：${this.spans.length} · **累计耗时**：${total}ms`);
    return lines.join('\n');
  }

  reset(): void {
    this.spans.length = 0;
    this.active = null;
    this.seq = 0;
  }
}

// 全局单例：一次 eval / 一次运行共用同一个 trace
export const tracer = new Tracer();
