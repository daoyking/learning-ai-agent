import { useCallback, useEffect, useMemo, useState } from 'react'
import { scanServices, previewAction } from './lib/api'
import { ServiceCard } from './components/ServiceCard'
import type { ScanResult, ServiceCard as Card } from './types'

const CATEGORY_ORDER = ['proxy', 'inference', 'gateway', 'rag', 'workspace', 'infra', 'devtool']

const CATEGORY_LABEL: Record<string, string> = {
  proxy: '网络出口',
  inference: '推理',
  gateway: '网关',
  rag: '向量与检索',
  workspace: '工作空间',
  infra: '基础设施',
  devtool: '开发工具',
}

export default function App() {
  const [data, setData] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await scanServices()
      setData(result)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const card of data?.services ?? []) {
      const list = map.get(card.category) ?? []
      list.push(card)
      map.set(card.category, list)
    }
    return [...map.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0])
    )
  }, [data])

  /** 未被任何 manifest 纳管的监听端口 = 自动发现的候选 */
  const unmanaged = useMemo(() => {
    if (!data) return []
    const known = new Set<number>()
    for (const m of data.services) {
      if (m.port) known.add(m.port)
    }
    return data.ports.filter((p) => !known.has(p.port)).slice(0, 60)
  }, [data])

  const stats = useMemo(() => {
    const services = data?.services ?? []
    return {
      total: services.length,
      running: services.filter((s) => s.status === 'running').length,
      stopped: services.filter((s) => s.status === 'stopped').length,
      unknown: services.filter((s) => s.status === 'unknown').length,
      conflicts: services.filter((s) => s.port_conflict).length,
      // 运行中但没人监管 —— 现在能用，崩了就起不来。必须单列统计，
      // 否则它会被"在线 7 个"这个数字完全盖住。
      unsupervised: services.filter(
        (s) => s.status === 'running' && s.supervised === 'unsupervised'
      ).length,
    }
  }, [data])

  const onPreviewStart = useCallback(async (id: string) => {
    setPreview(await previewAction(id, 'start'))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            Local Service Hub
          </h1>
          <span className="font-mono text-[10px] text-slate-500">
            {stats.running} 在线 · {stats.stopped} 未启动 · {stats.unknown} 未发现
            {stats.conflicts > 0 && ` · ${stats.conflicts} 端口冲突`}
            {stats.unsupervised > 0 && (
              <span className="text-amber-400"> · {stats.unsupervised} 在线但无守护</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {data?.source === 'snapshot' && (
            <span className="chip bg-ink-700 text-slate-400" title="数据来自 scripts/snapshot.mjs 生成的本机快照">
              快照模式
            </span>
          )}
          {data && (
            <span className="font-mono text-[10px] text-slate-600">
              {data.elapsed_ms}ms · {new Date(data.scanned_at_ms).toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-ink-600 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
          >
            {loading ? '扫描中…' : '重新扫描'}
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded border border-status-down/40 bg-status-down/10 px-3 py-2 text-[11px] text-status-down">
          {error}
        </div>
      )}

      {/* V0.1 的诚实声明：L1 绿灯不等于真能用 */}
      <div className="mx-5 mt-3 rounded border border-status-degraded/30 bg-status-degraded/[0.07] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-status-degraded">V0.1 仅 L1 判定。</b>
        绿色只代表端口在监听，<b>不代表服务真的能用</b>。
        L2（HTTP 就绪）与 L3（语义探针）在 V0.2 接入 —— 本机已知 3 类假活场景
        （OmniRoute 供应商假可用、Odysseus 模型数假 0、SearXNG 搜索结果本地化）都只能靠 L3 发现。
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-4">
        {grouped.map(([category, cards]) => (
          <section key={category} className="mb-5">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {CATEGORY_LABEL[category] ?? category}
              <span className="ml-1.5 text-slate-600">{cards.length}</span>
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {cards.map((card) => (
                <ServiceCard key={card.id} card={card} onPreviewStart={onPreviewStart} />
              ))}
            </div>
          </section>
        ))}

        <section className="mb-6">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            未纳管的监听端口
            <span className="ml-1.5 text-slate-600">{unmanaged.length}</span>
          </h2>
          <div className="card max-h-48 overflow-y-auto p-0">
            <table className="w-full font-mono text-[10px]">
              <tbody>
                {unmanaged.map((p) => (
                  <tr key={`${p.port}-${p.pid}`} className="border-b border-ink-700/60 last:border-0">
                    <td className="w-16 px-2.5 py-1 text-slate-300">:{p.port}</td>
                    <td className="w-20 px-2.5 py-1 text-slate-500">{p.pid}</td>
                    <td className="px-2.5 py-1 text-slate-400">{p.command}</td>
                    <td className="w-28 px-2.5 py-1 text-slate-600">{p.address}</td>
                  </tr>
                ))}
                {unmanaged.length === 0 && (
                  <tr>
                    <td className="px-2.5 py-2 text-slate-600">所有监听端口都已被 manifest 纳管</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
          onClick={() => setPreview(null)}
        >
          <div
            className="max-w-2xl rounded-lg border border-ink-600 bg-ink-800 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[11px] text-slate-400">
              V0.1 不执行启停，只回显命令（dry-run）
            </div>
            <pre className="whitespace-pre-wrap rounded bg-ink-900 p-3 font-mono text-[11px] text-slate-300">
              {preview}
            </pre>
            <button
              onClick={() => setPreview(null)}
              className="mt-3 rounded border border-ink-600 px-3 py-1 text-[11px] text-slate-300 hover:border-slate-500"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
