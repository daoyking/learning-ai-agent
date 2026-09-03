import type { ServiceCard as Card, L2ProbeStatus, SupervisionState } from '../types'
import { StatusDot, statusLabel } from './StatusDot'
import { runL2Probe } from '../lib/api'
import { useState } from 'react'

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

interface Props {
  card: Card
  l2Status: L2ProbeStatus | null
  onManage: (card: Card) => void
}

export function ServiceCard({ card, l2Status, onManage }: Props) {
  const conflict = card.port_conflict
  const sup = SUPERVISION[card.supervised ?? 'not_applicable']
  const [l2Loading, setL2Loading] = useState(false)
  const [l2Error, setL2Error] = useState<string | null>(null)

  const handleL2Probe = async () => {
    if (!card.id) return
    setL2Loading(true)
    setL2Error(null)
    try {
      await runL2Probe(card.id)
      // 手动触发后刷新父组件的 l2StatusMap
    } catch (e) {
      setL2Error(String(e))
    } finally {
      setL2Loading(false)
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
