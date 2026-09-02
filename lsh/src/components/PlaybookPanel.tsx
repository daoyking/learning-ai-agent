import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  diagnosePlaybook,
  listPlaybooks,
  matchPlaybooks,
  runProbes,
} from '../lib/api'
import type {
  ConclusionOut,
  DiagnoseResult,
  FixPreview,
  MatchedPlaybook,
  PlaybookSummary,
  ProbeRun,
} from '../types'

const SEVERITY_BADGE: Record<string, { label: string; cls: string }> = {
  critical: { label: '致命', cls: 'bg-rose-500/20 text-rose-300' },
  high: { label: '严重', cls: 'bg-orange-500/20 text-orange-300' },
  warn: { label: '警告', cls: 'bg-amber-500/20 text-amber-300' },
  info: { label: '提示', cls: 'bg-sky-500/20 text-sky-300' },
}

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-emerald-500/20 text-emerald-300' },
  medium: { label: '中', cls: 'bg-amber-500/20 text-amber-300' },
  low: { label: '低', cls: 'bg-slate-500/20 text-slate-300' },
}

/** V0.2 诊断台：跑探针 → 匹配剧本 → 只读诊断出证据链与根因 → 给出手动修复命令 */
export function PlaybookPanel() {
  const [summaries, setSummaries] = useState<PlaybookSummary[]>([])
  const [matched, setMatched] = useState<MatchedPlaybook[]>([])
  const [probes, setProbes] = useState<ProbeRun[]>([])
  const [selected, setSelected] = useState<DiagnoseResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSummaries = useCallback(async () => {
    try {
      setSummaries(await listPlaybooks())
    } catch {
      /* 浏览器预览模式下静默 */
    }
  }, [])

  useEffect(() => {
    void loadSummaries()
  }, [loadSummaries])

  /** 跑探针（联网/本地）然后匹配当前命中的剧本 */
  const runMatch = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSelected(null)
    try {
      const probeRuns = await runProbes()
      setProbes(probeRuns)
      const probeVars: Record<string, unknown> = {}
      for (const p of probeRuns) {
        if (p.ok) probeVars[`${p.service}.${p.probe}`] = p.vars
      }
      const matchedList = await matchPlaybooks({
        probe_vars: probeVars,
        home: '',
      })
      setMatched(matchedList)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const openDiagnose = useCallback(async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await diagnosePlaybook(id)
      setSelected(result)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const probeOk = useMemo(() => probes.filter((p) => p.ok).length, [probes])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">诊断台</h1>
          <span className="font-mono text-[10px] text-slate-500">
            {summaries.length} 个剧本 · 命中 {matched.length}
            {probes.length > 0 && ` · 探针 ${probeOk}/${probes.length} 通过`}
          </span>
        </div>
        <button
          onClick={() => void runMatch()}
          disabled={busy}
          className="rounded border border-ink-600 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
        >
          {busy ? '诊断中…' : '运行探针并匹配'}
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded border border-status-down/40 bg-status-down/10 px-3 py-2 text-[11px] text-status-down">
          {error}
        </div>
      )}

      <div className="mx-5 mt-3 rounded border border-status-degraded/30 bg-status-degraded/[0.07] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        <b className="text-status-degraded">V0.2 诊断台（只读）。</b>
        点「运行探针并匹配」：先跑各服务的 L3 语义探针，再用白名单表达式引擎评估触发器。
        命中的剧本可点开做<b>只读诊断</b>——采集证据链、推导根因，并给出修复命令
        （manual 模式，客户端不代执行写操作；assisted/auto 在 V0.3）。
      </div>

      <main className="flex-1 overflow-y-auto px-5 py-4">
        {selected ? (
          <DiagnoseView result={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 左：命中剧本 */}
            <section>
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                当前命中
                <span className="ml-1.5 text-slate-600">{matched.length}</span>
              </h2>
              {matched.length === 0 ? (
                <div className="card p-4 text-[11px] text-slate-600">
                  还没有命中。点右上角「运行探针并匹配」开始；或右侧从全部剧本里手动挑一个诊断。
                </div>
              ) : (
                <div className="space-y-2">
                  {matched.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => void openDiagnose(m.id)}
                      className="card w-full p-3 text-left transition-colors hover:border-slate-500"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            SEVERITY_BADGE[m.severity]?.cls ?? 'bg-ink-700 text-slate-400'
                          }`}
                        >
                          {SEVERITY_BADGE[m.severity]?.label ?? m.severity}
                        </span>
                        <span className="text-[12px] font-medium text-slate-200">{m.title}</span>
                      </div>
                      {m.symptom && (
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                          {m.symptom.length > 120 ? m.symptom.slice(0, 120) + '…' : m.symptom}
                        </div>
                      )}
                      <div className="mt-1 font-mono text-[10px] text-slate-600">
                        {m.trigger_summary}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* 右：全部剧本（手动入口） */}
            <section>
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                全部剧本
                <span className="ml-1.5 text-slate-600">{summaries.length}</span>
              </h2>
              <div className="space-y-1.5">
                {summaries.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => void openDiagnose(s.id)}
                    className="flex w-full items-center gap-2 rounded border border-ink-700 bg-ink-800/50 px-2.5 py-1.5 text-left transition-colors hover:border-slate-500"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        SEVERITY_BADGE[s.severity]?.cls ?? 'bg-ink-700 text-slate-400'
                      }`}
                    >
                      {SEVERITY_BADGE[s.severity]?.label ?? s.severity}
                    </span>
                    <span className="flex-1 truncate text-[11px] text-slate-300">{s.title}</span>
                    {s.requires_sudo && (
                      <span className="rounded bg-rose-500/15 px-1 text-[9px] text-rose-300">
                        需提权
                      </span>
                    )}
                    <span className="font-mono text-[9px] text-slate-600">{s.id}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function DiagnoseView({
  result,
  onBack,
}: {
  result: DiagnoseResult
  onBack: () => void
}) {
  const matchedConclusions = result.conclusions.filter((c) => c.matched)
  const sev = SEVERITY_BADGE[result.severity] ?? { label: result.severity, cls: 'bg-ink-700 text-slate-400' }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-500"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${sev.cls}`}>{sev.label}</span>
          <span className="text-sm font-semibold text-slate-100">{result.title}</span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">{result.id}</span>
        {result.partial && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            部分证据缺失
          </span>
        )}
      </div>

      {result.symptom && (
        <div className="mb-3 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          {result.symptom}
        </div>
      )}

      {/* 证据链（只读诊断步骤） */}
      <Section title="证据链（只读诊断）">
        <div className="space-y-2">
          {result.steps.map((s) => (
            <div key={s.id} className="rounded border border-ink-700 bg-ink-900 p-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-300">{s.title}</span>
                {s.error && (
                  <span className="rounded bg-rose-500/15 px-1 text-[9px] text-rose-300">
                    {s.optional ? '可选步骤失败' : '失败'}
                  </span>
                )}
              </div>
              {s.cmd && (
                <pre className="mt-1 whitespace-pre-wrap rounded bg-ink-950 p-1.5 font-mono text-[10px] text-slate-500">
                  {s.cmd}
                </pre>
              )}
              {s.output && (
                <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-ink-950 p-1.5 font-mono text-[10px] text-slate-300">
                  {s.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 根因结论 */}
      <Section title="根因结论">
        {matchedConclusions.length === 0 ? (
          <div className="rounded border border-ink-700 bg-ink-900 px-3 py-2 text-[11px] text-slate-500">
            证据不足以确诊（所有结论的断言均未命中）。可能是某些探针未运行或返回空。
          </div>
        ) : (
          <div className="space-y-2">
            {matchedConclusions.map((c, i) => (
              <ConclusionCard key={i} c={c} />
            ))}
          </div>
        )}
      </Section>

      {/* 修复命令（manual，V0.2 不给执行） */}
      {result.fix && result.fix.steps.length > 0 && (
        <FixSection fix={result.fix} />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  )
}

function ConclusionCard({ c }: { c: ConclusionOut }) {
  const conf = CONFIDENCE_BADGE[c.confidence] ?? {
    label: c.confidence,
    cls: 'bg-ink-700 text-slate-400',
  }
  return (
    <div className="rounded border border-ink-700 bg-ink-900 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${conf.cls}`}>
          置信度 {conf.label}
        </span>
        {c.recommended_fix && (
          <span className="font-mono text-[10px] text-slate-500">→ {c.recommended_fix}</span>
        )}
      </div>
      <div className="text-[12px] leading-relaxed text-slate-200">{c.root_cause}</div>
      {c.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {c.evidence.map((e, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-slate-400">
              <span className="text-slate-600">›</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FixSection({ fix }: { fix: FixPreview }) {
  const riskBadge =
    fix.risk === 'high'
      ? 'bg-rose-500/20 text-rose-300'
      : fix.risk === 'medium'
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-emerald-500/20 text-emerald-300'
  return (
    <Section title="建议的修复命令（manual · 客户端不代执行）">
      <div className="mb-2 flex items-center gap-2 text-[10px]">
        <span className={`rounded px-1.5 py-0.5 ${riskBadge}`}>风险 {fix.risk}</span>
        <span className="rounded bg-ink-700 px-1.5 py-0.5 text-slate-400">副作用 {fix.side_effects}</span>
        {fix.requires_sudo && (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">需提权</span>
        )}
      </div>
      <div className="space-y-2">
        {fix.steps.map((s) => (
          <div key={s.id} className="rounded border border-ink-700 bg-ink-900 p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-300">{s.title}</span>
              <span className="rounded bg-ink-700 px-1 text-[9px] text-slate-500">{s.kind}</span>
              {s.snapshot && (
                <span className="rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">执行前快照</span>
              )}
            </div>
            <pre className="whitespace-pre-wrap rounded bg-ink-950 p-1.5 font-mono text-[10px] text-slate-300">
              {s.command}
            </pre>
          </div>
        ))}
      </div>
    </Section>
  )
}
