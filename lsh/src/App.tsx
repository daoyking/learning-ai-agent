import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  scanServices,
  previewAction,
  runAction,
  runAllL2Probes,
  runAllL3Probes,
} from './lib/api'
import { ServiceCard } from './components/ServiceCard'
import { PlaybookPanel } from './components/PlaybookPanel'
import { LogPanel } from './components/LogPanel'
import { DoctorPanel } from './components/DoctorPanel'
import type {
  ActionPreview,
  L2ProbeStatus,
  L3Summary,
  RunActionResult,
  ScanResult,
  ServiceCard as Card,
} from './types'

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

/** 动作展示顺序与中文名 */
const ACTION_ORDER = ['start', 'stop', 'restart', 'status', 'bootstrap']
const ACTION_LABEL: Record<string, string> = {
  start: '启动',
  stop: '停止',
  restart: '重启',
  status: '状态',
  bootstrap: '注册',
}

const DANGER_BADGE: Record<string, { label: string; cls: string }> = {
  none: { label: '无风险', cls: 'bg-emerald-500/15 text-emerald-300' },
  confirm: { label: '需确认', cls: 'bg-amber-500/15 text-amber-300' },
  sudo: { label: '需提权', cls: 'bg-rose-500/15 text-rose-300' },
}

/** 长任务的进程包装方式 —— 决定服务能否在客户端退出后继续活着 */
const WRAP_LABEL: Record<string, string> = {
  setsid: 'setsid（脱离会话）',
  pty: 'pty（伪终端）',
  none: '不包装',
}

interface ManageState {
  card: Card
  preview: ActionPreview | null
  result: RunActionResult | null
  loading: boolean
  error: string | null
}

export default function App() {
  const [data, setData] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [manage, setManage] = useState<ManageState | null>(null)
  const [view, setView] = useState<'services' | 'playbooks' | 'logs' | 'doctor'>('services')
  const [l2StatusMap, setL2StatusMap] = useState<Record<string, L2ProbeStatus>>({})
  const [l2Loading, setL2Loading] = useState(false)
  /** 记录已跑过 L2 自动扫描的那份 data，避免 effect 因 l2Loading 变化而重复触发 */
  const l2ScannedFor = useRef<ScanResult | null>(null)
  // L3 语义探针结果。刻意不在启动时自动跑：L3 会真发请求（ollama 跑一次推理、
  // openclaw 冷启动 CLI 体检 60s+），全量 30–90s，开机即跑太重。
  const [l3Map, setL3Map] = useState<Record<string, L3Summary>>({})
  const [l3Loading, setL3Loading] = useState(false)
  const [l3Elapsed, setL3Elapsed] = useState(0)
  const [l3Error, setL3Error] = useState<string | null>(null)
  const l3Timer = useRef<number | null>(null)

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

  /** 扫描完成后异步预检所有 L2 探针 */
  const runL2Scan = useCallback(async () => {
    if (!data || data.services.length === 0) return
    setL2Loading(true)
    try {
      const l2Map = await runAllL2Probes()
      setL2StatusMap(l2Map)
    } catch (e) {
      console.error('L2 自动扫描失败:', e)
    } finally {
      setL2Loading(false)
    }
  }, [data])

  useEffect(() => {
    void load()
  }, [load])

  /** 扫描完成后触发 L2 自动扫描（每份 data 只跑一次） */
  useEffect(() => {
    if (!data || data.services.length === 0) return
    if (l2ScannedFor.current === data) return
    l2ScannedFor.current = data
    void runL2Scan()
  }, [data, runL2Scan])

  /** 卡片手动「检测」后回填 L2 结果到状态表 */
  const handleL2Result = useCallback((id: string, status: L2ProbeStatus) => {
    setL2StatusMap((prev) => ({ ...prev, [id]: status }))
  }, [])

  /** 全量 L3 深度体检（手动触发，带秒表；真正发请求，慢） */
  const runL3Scan = useCallback(async () => {
    setL3Loading(true)
    setL3Error(null)
    setL3Elapsed(0)
    const startedAt = Date.now()
    l3Timer.current = window.setInterval(() => {
      setL3Elapsed(Date.now() - startedAt)
    }, 500)
    try {
      setL3Map(await runAllL3Probes())
    } catch (e) {
      setL3Error(String(e))
    } finally {
      if (l3Timer.current !== null) {
        window.clearInterval(l3Timer.current)
        l3Timer.current = null
      }
      setL3Loading(false)
    }
  }, [])

  /** 卸载时清掉秒表，避免在已卸载组件上 setState */
  useEffect(
    () => () => {
      if (l3Timer.current !== null) window.clearInterval(l3Timer.current)
    },
    []
  )

  /** 卡片单服务「深检」后回填 L3 汇总 */
  const handleL3Result = useCallback((id: string, summary: L3Summary) => {
    setL3Map((prev) => ({ ...prev, [id]: summary }))
  }, [])

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

  /** L2 HTTP 探针汇总：区分"还没跑"和"跑了但失败" */
  const l2Stats = useMemo(() => {
    const values = Object.values(l2StatusMap)
    return {
      total: values.length,
      ok: values.filter((v) => v.ok).length,
      fail: values.filter((v) => !v.ok).length,
    }
  }, [l2StatusMap])

  /** L3 语义探针汇总：探针通过数 + 存在假活（有探针没过）的服务数 */
  const l3Stats = useMemo(() => {
    const values = Object.values(l3Map)
    return {
      services: values.length,
      pass: values.reduce((n, s) => n + s.pass, 0),
      total: values.reduce((n, s) => n + s.total, 0),
      fakeAlive: values.filter((s) => !s.ok).length,
    }
  }, [l3Map])

  const openManage = useCallback((card: Card) => {
    setManage({ card, preview: null, result: null, loading: false, error: null })
  }, [])

  const closeManage = useCallback(() => setManage(null), [])

  /** 点某个动作 → 先取预览（含安全等级），不执行 */
  const previewAnAction = useCallback(
    async (card: Card, action: string) => {
      setManage((m) =>
        m ? { ...m, preview: null, result: null, loading: true, error: null } : m
      )
      try {
        const preview = await previewAction(card.id, action)
        setManage((m) => (m ? { ...m, preview, loading: false } : m))
      } catch (e) {
        setManage((m) => (m ? { ...m, loading: false, error: String(e) } : m))
      }
    },
    []
  )

  /** 确认执行（confirmed=true） */
  const executeAction = useCallback(
    async (card: Card, action: string) => {
      setManage((m) =>
        m ? { ...m, result: null, loading: true, error: null } : m
      )
      try {
        const result = await runAction(card.id, action, true)
        setManage((m) => (m ? { ...m, result, loading: false } : m))
      } catch (e) {
        setManage((m) => (m ? { ...m, loading: false, error: String(e) } : m))
      }
    },
    []
  )

  const afterRunRescan = useCallback(async () => {
    await load()
    setManage(null)
  }, [load])

  // 按固定顺序展示该服务支持的动作
  const sortedActions = useMemo(() => {
    if (!manage) return []
    return [...manage.card.actions].sort(
      (a, b) =>
        ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b)
    )
  }, [manage])

  return (
    <div className="flex h-full flex-col">
      <TabBar view={view} onChange={setView} />

      {view === 'playbooks' ? (
        <PlaybookPanel />
      ) : view === 'logs' ? (
        <LogPanel />
      ) : view === 'doctor' ? (
        <DoctorPanel />
      ) : (
        <>
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
            {l2Stats.total > 0 && (
              <span className="text-slate-400">
                {' '}
                · L2 {l2Stats.ok}/{l2Stats.total} 通
                {l2Stats.fail > 0 && (
                  <span className="text-rose-400"> · {l2Stats.fail} 不通</span>
                )}
              </span>
            )}
            {l3Stats.total > 0 && (
              <span className="text-slate-400">
                {' '}
                · L3 {l3Stats.pass}/{l3Stats.total} 通
                {l3Stats.fakeAlive > 0 && (
                  <span className="text-amber-400">
                    {' '}
                    · {l3Stats.fakeAlive} 个服务假活
                  </span>
                )}
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {data?.source === 'snapshot' && (
            <span className="chip bg-ink-700 text-slate-400" title="数据来自 scripts/snapshot.mjs 生成的本机快照">
              快照模式
            </span>
          )}
          {l2Loading && (
            <span className="chip bg-ink-700 text-slate-400">L2 探测中…</span>
          )}
          {l3Error && (
            <span className="chip bg-status-down/15 text-status-down" title={l3Error}>
              L3 失败
            </span>
          )}
          {data && (
            <span className="font-mono text-[10px] text-slate-600">
              {data.elapsed_ms}ms · {new Date(data.scanned_at_ms).toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={() => void runL3Scan()}
            disabled={l3Loading}
            title="L3 语义探针会真实发起请求：ollama 跑一次推理、searxng 真搜一次、openclaw 冷启动 CLI 做插件体检。全量约 30–90 秒，因此不随启动自动跑。"
            className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 transition-colors hover:border-amber-400 hover:text-amber-200 disabled:opacity-50"
          >
            {l3Loading ? `L3 深检中 ${(l3Elapsed / 1000).toFixed(0)}s` : 'L3 深度体检'}
          </button>
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

      {/* V0.8 能力声明：L1 端口 + L2 HTTP + L3 语义探针 */}
      <div className="mx-5 mt-3 rounded border border-status-degraded/30 bg-status-degraded/[0.07] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-status-degraded">V0.8：L1 端口 + L2 HTTP + L3 语义探针。</b>
        启动后自动跑 L2（真实 curl）；L3 因要真发请求（跑推理 / 真搜一次 / 冷启动 CLI
        体检）耗时 30–90 秒，改由顶部 <b>L3 深度体检</b> 手动触发，卡片「深检」可单服务复测。
        <b>L1/L2 绿但 L3 红 = 假活</b> —— 端口在、心跳在、能力不在。
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
                <ServiceCard
                  key={card.id}
                  card={card}
                  l2Status={l2StatusMap[card.id]}
                  l3Summary={l3Map[card.id] ?? null}
                  onManage={openManage}
                  onL2Result={handleL2Result}
                  onL3Result={handleL3Result}
                />
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

      {manage && (
        <ManageModal
          state={manage}
          actions={sortedActions}
          onClose={closeManage}
          onPreview={previewAnAction}
          onExecute={executeAction}
          onRescan={afterRunRescan}
        />
      )}
        </>
      )}
    </div>
  )
}

function TabBar({
  view,
  onChange,
}: {
  view: 'services' | 'playbooks' | 'logs' | 'doctor'
  onChange: (v: 'services' | 'playbooks' | 'logs' | 'doctor') => void
}) {
  const tabs: { id: 'services' | 'playbooks' | 'logs' | 'doctor'; label: string }[] = [
    { id: 'services', label: '服务' },
    { id: 'playbooks', label: '诊断台' },
    { id: 'logs', label: '日志' },
    { id: 'doctor', label: '体检' },
  ]
  return (
    <div className="flex items-center gap-1 border-b border-ink-700 bg-ink-900 px-3 py-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
            view === t.id
              ? 'bg-ink-700 text-slate-100'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ManageModal({
  state,
  actions,
  onClose,
  onPreview,
  onExecute,
  onRescan,
}: {
  state: ManageState
  actions: string[]
  onClose: () => void
  onPreview: (card: Card, action: string) => void
  onExecute: (card: Card, action: string) => void
  onRescan: () => void
}) {
  const { card, preview, result, loading, error } = state
  const badge = preview ? DANGER_BADGE[preview.danger] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-ink-600 bg-ink-800 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-100">{card.name}</div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">
              {card.id} · :{card.port ?? '—'} · {card.supervisor_kind}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-500"
          >
            关闭
          </button>
        </div>

        {/* 动作列表 */}
        <div className="mb-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a}
              onClick={() => onPreview(card, a)}
              disabled={loading}
              className="rounded border border-ink-600 px-3 py-1 text-[11px] text-slate-200 transition-colors hover:border-slate-400 hover:bg-ink-700 disabled:opacity-40"
            >
              {ACTION_LABEL[a] ?? a}
            </button>
          ))}
        </div>

        {loading && <div className="text-[11px] text-slate-500">执行中…</div>}

        {error && (
          <div className="mb-2 rounded border border-status-down/40 bg-status-down/10 px-2 py-1.5 text-[11px] text-status-down">
            {error}
          </div>
        )}

        {/* 预览 / 结果区 */}
        {preview && !result && (
          <div className="rounded border border-ink-700 bg-ink-900 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-slate-300">
                将执行：{ACTION_LABEL[preview.effective_action] ?? preview.effective_action}
              </span>
              {badge && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
            </div>

            {preview.rerouted && (
              <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                前置条件不满足：{preview.rerouted}
                （已改用 {preview.effective_action} 代替原动作）
              </div>
            )}

            {preview.wrap !== 'none' && (
              <div className="mb-2 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-300">
                <div className="mb-0.5">
                  进程包装：
                  <span className="font-mono">{WRAP_LABEL[preview.wrap] ?? preview.wrap}</span>
                  {preview.wrap_reason && (
                    <span className="text-sky-400/80"> — {preview.wrap_reason}</span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-slate-500">
                  实际执行：{preview.wrapped_command}
                </div>
              </div>
            )}

            <pre className="mb-1 whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[11px] text-slate-300">
              {preview.command}
            </pre>
            <div className="font-mono text-[10px] text-slate-600">cwd: {preview.cwd}</div>

            {preview.sudo_required ? (
              <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-2 text-[11px] text-rose-300">
                该动作需要 sudo / 提权，客户端不代执行。请在终端手动运行上面的命令。
              </div>
            ) : (
              <button
                onClick={() => onExecute(card, preview.action)}
                className={`mt-3 rounded px-3 py-1 text-[11px] text-white transition-colors ${
                  preview.requires_confirm
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {preview.requires_confirm ? '确认执行' : '执行'}
              </button>
            )}
          </div>
        )}

        {result && (
          <div className="rounded border border-ink-700 bg-ink-900 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-slate-300">
                {ACTION_LABEL[result.effective_action] ?? result.effective_action} 结果
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  result.executed && !result.error
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {result.executed && !result.error
                  ? result.spawned_pid
                    ? `已拉起 pid=${result.spawned_pid}`
                    : `完成 (exit ${result.exit_code ?? '?'})`
                  : '未完成'}
              </span>
            </div>

            {result.output && (
              <pre className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[11px] text-slate-300">
                {result.output}
              </pre>
            )}
            {result.error && (
              <div className="mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
                {result.error}
              </div>
            )}

            <button
              onClick={onRescan}
              className="mt-1 rounded border border-ink-600 px-3 py-1 text-[11px] text-slate-300 hover:border-slate-500"
            >
              重新扫描确认
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
