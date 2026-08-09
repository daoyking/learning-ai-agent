// langfuse.ts — 把自建 Tracer 的 span 时间线导出到真实 Langfuse（生产可观测）
//
// 设计原则（与 W5 零依赖 Tracer 一致）：
//   - 不强制依赖 `langfuse` 包；只有配置了 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 时才动态加载。
//   - 未配置 key 时 `flush()` 直接 no-op，离线 / CI 零 key 也能跑，不影响既有流程。
//   - 初始化失败（如装了包却没网）自动降级为离线 trace，并打印一次告警，不抛错中断评测。
//
// Langfuse 与自建 Tracer 是同一套 mental model：
//   Tracer.span 树  ──映射──▶  Langfuse trace + 嵌套 observation（span / generation）
//   - 顶层 span（parentId=null）→ Langfuse trace 下的顶级 observation
//   - name 含 `model:` 的 span → generation（模型调用），其余 → span
//   - span.attributes + events → observation.metadata（保留可观测细节）

import { tracer, type Span } from './trace.js';

export interface LangfuseConfig {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}

export class LangfuseExporter {
  private client: any = null;
  private warned = false;

  constructor(private cfg: LangfuseConfig = {}) {}

  /** 是否真的会导出：两个 key 都存在才为 true */
  get enabled(): boolean {
    return Boolean(
      (this.cfg.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY) &&
        (this.cfg.secretKey ?? process.env.LANGFUSE_SECRET_KEY),
    );
  }

  private async ensure(): Promise<any | null> {
    if (!this.enabled) return null;
    if (this.client) return this.client;
    try {
      const mod: any = await import('langfuse');
      const Langfuse = mod.Langfuse ?? mod.default?.Langfuse ?? mod.default;
      if (typeof Langfuse !== 'function') {
        throw new Error('langfuse 包未导出 Langfuse 构造器（请升级 langfuse 到 v3+）');
      }
      this.client = new Langfuse({
        publicKey: this.cfg.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: this.cfg.secretKey ?? process.env.LANGFUSE_SECRET_KEY,
        baseUrl: this.cfg.baseUrl ?? process.env.LANGFUSE_HOST,
      });
      return this.client;
    } catch (e: any) {
      if (!this.warned) {
        console.warn(
          `⚠️  Langfuse 初始化失败（已降级为离线 trace）：${e?.message ?? e}\n` +
            `   若要用真实可观测，请先 \`npm install langfuse\` 并配置 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY。`,
        );
        this.warned = true;
      }
      return null;
    }
  }

  /** 把当前 Tracer 的 spans 导出成一个 Langfuse trace（含嵌套 observation）。无 key 时直接返回。 */
  async flush(spans: Span[] = tracer.spans): Promise<void> {
    const client = await this.ensure();
    if (!client) return;
    try {
      const trace = client.trace({
        name: 'agent-eval',
        metadata: { spanCount: spans.length, source: 'w5-tracer' },
      });
      const byId = new Map<string, any>();
      // 按开始时间排序，保证父 observation 先于子 observation 创建
      const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);
      for (const s of sorted) {
        const common = {
          name: s.name,
          startTime: new Date(s.startTime),
          endTime: s.endTime ? new Date(s.endTime) : undefined,
          metadata: { ...s.attributes, events: s.events },
        };
        let obs: any;
        const parent = s.parentId ? byId.get(s.parentId) : undefined;
        if (s.name.includes('model:')) {
          obs = parent ? parent.generation(common) : trace.generation(common);
        } else {
          obs = parent ? parent.span(common) : trace.span(common);
        }
        byId.set(s.id, obs);
      }
      await client.flush();
    } catch (e: any) {
      if (!this.warned) {
        console.warn(`⚠️  Langfuse 导出失败（已降级为离线 trace）：${e?.message ?? e}`);
        this.warned = true;
      }
    }
  }
}

// 全局单例：runEval / demo 共用，自动随环境变量决定是否导出
export const langfuseExporter = new LangfuseExporter();
