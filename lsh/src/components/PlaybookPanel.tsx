import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyFix,
  diagnosePlaybook,
  listPlaybooks,
  matchPlaybooks,
  runProbes,
} from '../lib/api'
import type {
  ConclusionOut,
  DiagnoseResult,
  FixApplyResult,
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
        <b className="text-status-degraded">诊断台。</b>
        点「运行探针并匹配」：先跑各服务的 L3 语义探针，再用白名单表达式引擎评估触发器。
        命中的剧本可点开做<b>只读诊断</b>——采集证据链、推导根因。
        assisted/auto 剧本可直接<b>一键修复</b>（带快照回滚 + 执行后复检）；manual/sudo 仅展示命令。
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

      {/* 修复（V0.3：assisted/auto 可一键执行；manual 仅展示） */}
      {result.fix && result.fix.steps.length > 0 && (
        <FixRunner fix={result.fix} playbookId={result.id} />
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

const MODE_LABEL: Record<string, string> = {
  manual: '手动（只给命令）',
  assisted: '辅助（可一键执行）',
  auto: '自动',
}

/**
 * 修复执行器。
 *
 * 三道闸门，任何一道不满足就不代执行 —— 这是"一键修复"能让人放心的前提：
 *   1. mode=manual      → V0.2 默认档，只展示命令，用户自己在终端跑
 *   2. requires_sudo    → 提权动作一律不代执行（同启停的安全红线）
 *   3. needs_confirm    → 后端要求确认时先回 needs_confirm，由用户点头再跑
 */
function FixRunner({ fix, playbookId }: { fix: FixPreview; playbookId: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FixApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await applyFix(playbookId, true))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [playbookId])

  const blocked =
    fix.mode === 'manual'
      ? '当前为手动模式：请在终端自行执行上面的命令。客户端不做代执行 —— 修复动作会改文件或重启服务，先让你看清每一步。'
      : fix.requires_sudo
        ? '该修复需要提权，客户端不代执行。请在终端手动运行上面的命令。'
        : null

  return (
    <>
      <FixSection fix={fix} />

      <Section title="执行修复">
        {blocked ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            {blocked}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1 text-[11px] text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? '执行中…' : '一键修复'}
            </button>
            <span className="text-[10px] text-slate-500">
              {MODE_LABEL[fix.mode] ?? fix.mode}
              {fix.confirm && ' · 需确认'}
            </span>
          </div>
        )}

        {error && (
          <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        {result && <FixResultView result={result} />}
      </Section>
    </>
  )
}

function FixResultView({ result }: { result: FixApplyResult }) {
  if (result.rejected_sudo) {
    return (
      <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
        已拒绝：该修复需要提权，客户端不代执行。
      </div>
    )
  }
  if (result.needs_confirm) {
    return (
      <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
        该剧本要求确认后才执行，未执行任何写操作。
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {result.steps.map((s) => (
        <div key={s.id} className="rounded border border-ink-700 bg-ink-900 p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-300">{s.title}</span>
            {s.skipped ? (
              <span className="rounded bg-slate-500/20 px-1 text-[9px] text-slate-400">
                已跳过{s.skip_reason ? `：${s.skip_reason}` : ''}
              </span>
            ) : s.error ? (
              <span className="rounded bg-rose-500/20 px-1 text-[9px] text-rose-300">
                失败 exit={s.exit ?? '?'}
              </span>
            ) : (
              <span className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-300">
                完成 exit={s.exit ?? 0}
              </span>
            )}
            {s.rolled_back && (
              <span className="rounded bg-sky-500/20 px-1 text-[9px] text-sky-300">已回滚</span>
            )}
          </div>
          <pre className="whitespace-pre-wrap rounded bg-ink-950 p-1.5 font-mono text-[10px] text-slate-500">
            {s.command}
          </pre>
          {s.output && (
            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-ink-950 p-1.5 font-mono text-[10px] text-slate-300">
              {s.output}
            </pre>
          )}
          {s.error && (
            <div className="mt-1 text-[10px] text-rose-300">{s.error}</div>
          )}
        </div>
      ))}

      {result.verify && (
        <div
          className={`rounded border px-2 py-1.5 text-[11px] ${
            result.verify.passed
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          复检{result.verify.passed ? '通过' : '未通过'}：{result.verify.detail}
        </div>
      )}

      {result.rollback_note && (
        <div className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-[10px] text-slate-400">
          回滚方式：{result.rollback_note}
        </div>
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
    <Section title="修复步骤预览">
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
