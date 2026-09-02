import { useCallback, useEffect, useState } from 'react'
import { listLogSources, tailLogs, rotateLog, scanServices } from '../lib/api'
import type { LogSourceView, LogTail, ScanResult } from '../types'

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  file: { label: '文件', cls: 'bg-sky-500/20 text-sky-300' },
  container: { label: '容器', cls: 'bg-violet-500/20 text-violet-300' },
  command: { label: '命令', cls: 'bg-emerald-500/20 text-emerald-300' },
  label: { label: '日志流', cls: 'bg-amber-500/20 text-amber-300' },
}

/** V0.2 日志中心：选服务 → 列出所有日志源 → 聚合尾部 / 超阈值告警 / copytruncate 旋转 */
export function LogPanel() {
  const [services, setServices] = useState<ScanResult['services']>([])
  const [serviceId, setServiceId] = useState<string>('')
  const [sources, setSources] = useState<LogSourceView[]>([])
  const [tails, setTails] = useState<Record<string, LogTail>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const r = await scanServices()
        setServices(r.services)
        const first = r.services.find((s) => s.log_count > 0) ?? r.services[0]
        if (first) setServiceId(first.id)
      } catch {
        /* 浏览器预览静默 */
      }
    })()
  }, [])

  const loadSources = useCallback(
    async (sid: string) => {
      if (!sid) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        setSources(await listLogSources(sid))
      } catch (e) {
        setError(String(e))
      } finally {
        setBusy(false)
      }
    },
    []
  )

  useEffect(() => {
    void loadSources(serviceId)
  }, [serviceId, loadSources])

  const doTail = useCallback(
    async (sid: string) => {
      if (!sid) return
      setError(null)
      try {
        const out = await tailLogs(sid, 200)
        const map: Record<string, LogTail> = {}
        for (const t of out) map[t.source_id] = t
        setTails((prev) => ({ ...prev, ...map }))
      } catch (e) {
        setError(String(e))
      }
    },
    []
  )

  const doRotate = useCallback(
    async (sid: string, sourceId: string) => {
      if (!confirm(`确认旋转 ${sourceId}？会先备份再清空原文件（copytruncate）。`)) return
      setNotice(null)
      try {
        const msg = await rotateLog(sid, sourceId)
        setNotice(msg)
        await doTail(sid)
      } catch (e) {
        setError(String(e))
      }
    },
    [doTail]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">日志中心</h1>
          <span className="font-mono text-[10px] text-slate-500">
            {sources.length} 个日志源
          </span>
        </div>
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.log_count > 0 ? `(${s.log_count})` : ''}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded border border-status-down/40 bg-status-down/10 px-3 py-2 text-[11px] text-status-down">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-5 mt-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
          {notice}
        </div>
      )}

      <div className="mx-5 mt-3 rounded border border-status-degraded/30 bg-status-degraded/[0.07] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-status-degraded">V0.2 日志中心（只读聚合）。</b>
        列出该服务在 manifest 里声明的所有日志源，点「抓取尾部」实时查看最近 200 行。
        当文件超过 <code className="font-mono text-slate-300">rotate.max_size</code> 时给出超阈值提示，
        并可手动触发 copytruncate 旋转（先备份再清空）。
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-4">
        {busy && <div className="text-[11px] text-slate-500">加载日志源…</div>}
        {!busy && sources.length === 0 && (
          <div className="card p-4 text-[11px] text-slate-600">
            该服务没有声明任何日志源（log_count = 0）。
          </div>
        )}

        <div className="space-y-3">
          {sources.map((src) => {
            const tail = tails[src.source_id]
            const badge = KIND_BADGE[src.kind] ?? { label: src.kind, cls: 'bg-ink-700 text-slate-400' }
            return (
              <div key={src.source_id} className="card p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="font-mono text-[11px] text-slate-200">{src.source_id}</span>
                  {src.rotate && (
                    <span className="font-mono text-[9px] text-slate-500">
                      旋转上限 {src.rotate.max_size} · 保留 {src.rotate.keep}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => void doTail(serviceId)}
                      className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
                    >
                      抓取尾部
                    </button>
                    {src.rotate && (
                      <button
                        onClick={() => void doRotate(serviceId, src.source_id)}
                        className="rounded border border-amber-600/50 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-600/10"
                      >
                        旋转
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-1.5 truncate font-mono text-[10px] text-slate-500">
                  {src.path ?? src.container ?? src.command ?? src.label ?? '(无目标)'}
                </div>

                {tail?.error && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300">
                    {tail.error}
                  </div>
                )}

                {tail && !tail.error && (
                  <div>
                    {tail.over_threshold && (
                      <div className="mb-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
                        ⚠ 文件已超过旋转阈值 {tail.rotate?.max_size}，建议旋转。
                      </div>
                    )}
                    {tail.truncated_from != null && (
                      <div className="mb-1 font-mono text-[9px] text-slate-600">
                        （共 {tail.truncated_from} 行，仅显示末尾 200 行）
                      </div>
                    )}
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-ink-950 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
                      {tail.lines || '(空)'}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
