import { useCallback, useEffect, useMemo, useState } from 'react'
import { runDoctor, updateTrayStatus } from '../lib/api'
import type { DoctorCheck, CheckStatus } from '../types'

const STATUS_BADGE: Record<CheckStatus, { label: string; cls: string; dot: string }> = {
  ok: { label: '通过', cls: 'bg-emerald-500/15 text-emerald-300', dot: 'bg-emerald-400' },
  warn: { label: '警告', cls: 'bg-amber-500/15 text-amber-300', dot: 'bg-amber-400' },
  fail: { label: '失败', cls: 'bg-rose-500/15 text-rose-300', dot: 'bg-rose-400' },
}

/** V0.2 环境体检：只读电池化自检（node / 探针 / 监管 / 端口冲突），不修复 */
export function DoctorPanel() {
  const [checks, setChecks] = useState<DoctorCheck[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await runDoctor()
      setChecks(result)
      // 把整体结论同步到托盘：tooltip 文字 + 图标变色（ok/warn/fail 三色）
      const summary = result.find((c) => c.id === 'summary')
      if (summary) {
        await updateTrayStatus(`LSH · ${summary.detail}`, summary.status)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const { fail, warn, ok } = useMemo(() => {
    let fail = 0
    let warn = 0
    let ok = 0
    for (const c of checks) {
      if (c.id === 'summary') continue
      if (c.status === 'fail') fail++
      else if (c.status === 'warn') warn++
      else ok++
    }
    return { fail, warn, ok }
  }, [checks])

  const summary = checks.find((c) => c.id === 'summary')
  const summaryBadge = summary ? STATUS_BADGE[summary.status] : null
  const rest = checks.filter((c) => c.id !== 'summary')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">环境体检</h1>
          <span className="font-mono text-[10px] text-slate-500">
            {ok} 通过 · {warn} 警告 · {fail} 失败
          </span>
        </div>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded border border-ink-600 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
        >
          {busy ? '体检中…' : '重新体检'}
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded border border-status-down/40 bg-status-down/10 px-3 py-2 text-[11px] text-status-down">
          {error}
        </div>
      )}

      <div className="mx-5 mt-3 rounded border border-status-degraded/30 bg-status-degraded/[0.07] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-status-degraded">V0.2 体检（只读）。</b>
        逐项检查 Node 运行时、L3 语义探针、各服务的监管状态与端口冲突，
        帮你一眼看清「这台机器现在健康吗」。不修任何东西，修复请走诊断台 Playbook。
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-4">
        {busy && checks.length === 0 && (
          <div className="text-[11px] text-slate-500">正在检查本机…（含联网探针，约数秒）</div>
        )}

        {summary && summaryBadge && (
          <div
            className={`mb-4 flex items-center gap-3 rounded border px-3 py-2.5 ${summaryBadge.cls} border-current/30`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${summaryBadge.dot}`} />
            <div>
              <div className="text-[12px] font-semibold">{summary.title}</div>
              <div className="font-mono text-[10px] opacity-80">{summary.detail}</div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {rest.map((c) => {
            const badge = STATUS_BADGE[c.status]
            return (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded border border-ink-700 bg-ink-800/50 px-3 py-2"
              >
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-200">{c.title}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                    {c.detail}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
