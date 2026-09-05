import type {
  ServiceCard as Card,
  L2ProbeStatus,
  L3Summary,
  ProbeRun,
  SupervisionState,
} from '../types'
import { StatusDot, statusLabel } from './StatusDot'
import { runL2Probe, runServiceL3Probes } from '../lib/api'
import { formatAge } from '../lib/l3Store'
import { useEffect, useRef, useState } from 'react'

const SUPERVISION: Record<
  SupervisionState,
  { label: string; color: string; hint: string } | null
> = {
  supervised: {
    label: '已托管',
    color: '#22C55E',
    hint: '有守护进程接管，崩溃后会自动拉起',
  },
  unsupervised: {
    label: '未托管',
    color: '#F59E0B',
    hint: '没有守护进程。崩了不会自动恢复，重启机器后需要手动拉起',
  },
  not_applicable: null, // GUI 应用等，用户自己开关属正常，不显示不打扰
  unknown: {
    label: '监管状态未知',
    color: '#94A3B8',
    hint: '没能判定出监管状态，请自行确认',
  },
}

const KIND_LABEL: Record<string, string> = {
  launchd: 'launchd',
  docker: 'Docker',
  app: 'GUI App',
  script: '脚本',
  pty: '伪终端',
}

const KIND_COLOR: Record<string, string> = {
  launchd: '#38BDF8',
  docker: '#2496ED',
  app: '#A78BFA',
  script: '#FBBF24',
  pty: '#F472B6',
}

/**
 * 从探针结果里抽出人话失败原因。
 *
 * 探针输出形状不统一：assert 过的会被 apply_assert 包一层 {ok, result}，
 * 原始脚本的输出又直接摊平在顶层，所以 error / reason / hint 都要找一遍。
 */
function l3Reason(run: ProbeRun): string {
  const read = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null
    const rec = o as Record<string, unknown>
    for (const key of ['error', 'reason', 'hint']) {
      const v = rec[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return null
  }
  const vars = run.vars
  const nested =
    vars && typeof vars === 'object'
      ? (vars as Record<string, unknown>).result
      : null
  return read(vars) ?? read(nested) ?? run.raw.slice(0, 160)
}

interface Props {
  card: Card
  l2Status: L2ProbeStatus | null
  l3Summary: L3Summary | null
  onManage: (card: Card) => void
  onL2Result: (id: string, status: L2ProbeStatus) => void
  onL3Result: (id: string, summary: L3Summary) => void
}

export function ServiceCard({
  card,
  l2Status,
  l3Summary,
  onManage,
  onL2Result,
  onL3Result,
}: Props) {
  const conflict = card.port_conflict
  const sup = SUPERVISION[card.supervised ?? 'not_applicable']
  const [l2Loading, setL2Loading] = useState(false)
  const [l2Error, setL2Error] = useState<string | null>(null)
  const [l3Loading, setL3Loading] = useState(false)
  const [l3Error, setL3Error] = useState<string | null>(null)
  const [l3Open, setL3Open] = useState(false)
  const [l3Elapsed, setL3Elapsed] = useState(0)
  const l3Timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (l3Timer.current !== null) window.clearInterval(l3Timer.current)
    },
    []
  )

  const handleL2Probe = async () => {
    if (!card.id) return
    setL2Loading(true)
    setL2Error(null)
    try {
      const result = await runL2Probe(card.id)
      onL2Result(card.id, result)
    } catch (e) {
      setL2Error(String(e))
    } finally {
      setL2Loading(false)
    }
  }

  /** 单服务深检：openclaw 这类能跑 60s+，所以带秒表 */
  const handleL3Probe = async () => {
    if (!card.id) return
    setL3Loading(true)
    setL3Error(null)
    setL3Elapsed(0)
    const startedAt = Date.now()
    l3Timer.current = window.setInterval(() => {
      setL3Elapsed(Date.now() - startedAt)
    }, 500)
    try {
      const summary = await runServiceL3Probes(card.id)
      if (summary) onL3Result(card.id, summary)
      setL3Open(true)
    } catch (e) {
      setL3Error(String(e))
    } finally {
      if (l3Timer.current !== null) {
        window.clearInterval(l3Timer.current)
        l3Timer.current = null
      }
      setL3Loading(false)
    }
  }

  return (
    <div className="card flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={card.status} supervised={card.supervised} />
          <span className="truncate font-medium text-slate-100">{card.name}</span>
        </div>
        <span
          className="chip shrink-0"
          style={{
            background: `${KIND_COLOR[card.supervisor_kind] ?? '#64748B'}1A`,
            color: KIND_COLOR[card.supervisor_kind] ?? '#94A3B8',
          }}
        >
          {KIND_LABEL[card.supervisor_kind] ?? card.supervisor_kind}
        </span>
      </div>

      {/* 运行中但无人监管：最容易被"端口通=健康"骗过去的一类风险 */}
      {sup && card.supervised === 'unsupervised' && card.status === 'running' && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">
          运行中，但<b>没有守护进程</b>接管 —— 崩溃后不会自动拉起
        </div>
      )}

      {card.description && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-500">
          {card.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
        <span className="chip bg-ink-700 text-slate-300">
          :{card.port ?? '—'}
        </span>
        {card.pid != null && (
          <span className="chip bg-ink-700 text-slate-400">pid {card.pid}</span>
        )}
        {card.process && (
          <span className="chip bg-ink-700 text-slate-400">{card.process}</span>
        )}
      </div>

      {/* 端口被别的进程占了 —— 这类问题最常见也最难查，单独高亮 */}
      {conflict && (
        <div className="rounded border border-status-degraded/40 bg-status-degraded/10 px-2 py-1.5 text-[11px] text-status-degraded">
          端口 {conflict.port} 被 <b>{conflict.command}</b> (pid {conflict.pid}) 占用
        </div>
      )}

      {/* L2 HTTP 探针结果 */}
      {card.port != null && (
        <div className="flex items-center justify-between rounded border border-ink-700 bg-ink-900/50 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">L2 HTTP 探针</span>
            {l2Status && (
              <span className={`text-[10px] ${l2Status.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {l2Status.ok ? '✓' : '✗'} :{l2Status.status} ({l2Status.ms}ms)
              </span>
            )}
            {l2Error && (
              <span className="text-[10px] text-rose-400">{l2Error}</span>
            )}
          </div>
          <button
            onClick={handleL2Probe}
            disabled={l2Loading}
            className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
          >
            {l2Loading ? '检测中…' : '检测'}
          </button>
        </div>
      )}

      {/* L3 语义探针 —— 唯一能证明「服务真的能用」的一层 */}
      {card.l3_count > 0 && (
        <div className="rounded border border-ink-700 bg-ink-900/50">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[10px] text-slate-500">L3 语义</span>
              {l3Summary ? (
                <button
                  onClick={() => setL3Open((v) => !v)}
                  className="flex min-w-0 items-center gap-1.5 text-[10px] hover:opacity-80"
                  title="展开查看每个探针在验什么"
                >
                  <span
                    className={
                      l3Summary.ok ? 'text-emerald-400' : 'text-amber-400'
                    }
                  >
                    {l3Summary.ok ? '✓' : '⚠'} {l3Summary.pass}/{l3Summary.total}
                  </span>
                  <span className="text-slate-600">{l3Summary.ms}ms</span>
                  <span className="text-slate-600">{l3Open ? '▴' : '▾'}</span>
                </button>
              ) : (
                <span className="text-[10px] text-slate-600">未检测</span>
              )}
              {l3Error && (
                <span className="truncate text-[10px] text-rose-400" title={l3Error}>
                  {l3Error}
                </span>
              )}
            </div>
            <button
              onClick={handleL3Probe}
              disabled={l3Loading}
              className="shrink-0 rounded border border-ink-600 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40"
              title="只跑这个服务的语义探针（真发请求，openclaw 约 60s）"
            >
              {l3Loading ? `深检 ${(l3Elapsed / 1000).toFixed(0)}s` : '深检'}
            </button>
          </div>

          {l3Open && l3Summary && (
            <div className="space-y-1.5 border-t border-ink-700 px-2 py-1.5">
              {l3Summary.runs.map((run) => (
                <div key={run.probe} className="text-[10px] leading-relaxed">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={run.ok ? 'text-emerald-400' : 'text-rose-400'}
                    >
                      {run.ok ? '✓' : '✗'}
                    </span>
                    <span className="font-mono text-slate-400">{run.probe}</span>
                    <span className="text-slate-600">{run.ms}ms</span>
                  </div>
                  {run.desc && (
                    <div className="pl-4 text-slate-500">{run.desc}</div>
                  )}
                  {!run.ok && (
                    <div className="break-words pl-4 text-rose-300/80">
                      {l3Reason(run)}
                    </div>
                  )}
                </div>
              ))}
              <div className="border-t border-ink-700/60 pt-1 text-[10px] text-slate-600">
                检测于 {new Date(l3Summary.at).toLocaleString('zh-CN')}（
                {formatAge(l3Summary.at)}）· 合计 {l3Summary.ms}ms
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">{statusLabel(card.status)}</span>
          {sup && (
            <span
              className="text-[10px]"
              style={{ color: sup.color }}
              title={sup.hint}
            >
              · {sup.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {card.depends_on.length > 0 && (
            <span className="text-[10px] text-slate-600">
              ← {card.depends_on.join(', ')}
            </span>
          )}
          <button
            onClick={() => onManage(card)}
            className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
            title="管理：预览并真实执行启停动作"
          >
            管理
          </button>
        </div>
      </div>
    </div>
  )
}
