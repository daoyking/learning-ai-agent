import type { ServiceStatus, SupervisionState } from '../types'

const MAP: Record<ServiceStatus, { color: string; label: string; hint: string }> = {
  running: {
    color: '#22C55E',
    label: 'L1 存活',
    hint: '端口在监听。注意：这只是 L1 级判定，不代表服务真的能用（L2/L3 探针在 V0.2 接入）',
  },
  stopped: {
    color: '#64748B',
    label: '未启动',
    hint: '本机有安装痕迹，但端口没有在监听',
  },
  unknown: {
    color: '#475569',
    label: '未发现',
    hint: '没有找到安装痕迹，也可能只是当前没启动',
  },
}

/**
 * 状态灯取色。
 *
 * 关键规则：running 但未监管 → 琥珀，绝不显绿。
 * 绿色会让用户以为一切正常，而实际上这个服务崩了就再也起不来。
 * 本机实测 OmniRoute 正是这个状态（端口在跑，launchd job 从未加载）。
 */
export function dotColor(status: ServiceStatus, supervised?: SupervisionState): string {
  if (status === 'running' && supervised === 'unsupervised') return '#F59E0B'
  return MAP[status].color
}

export function StatusDot({
  status,
  supervised,
  size = 8,
}: {
  status: ServiceStatus
  supervised?: SupervisionState
  size?: number
}) {
  const color = dotColor(status, supervised)
  const unsupervised = status === 'running' && supervised === 'unsupervised'
  const hint = unsupervised
    ? '端口在监听，但没有守护进程接管 —— 崩溃后不会自动拉起，重启后需手动恢复'
    : MAP[status].hint

  return (
    <span
      title={hint}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: status === 'running' ? `0 0 6px ${color}80` : undefined,
      }}
    />
  )
}

export function statusLabel(status: ServiceStatus) {
  return MAP[status].label
}
