import { invoke } from '@tauri-apps/api/core'
import type {
  ActionPreview,
  L2ProbeStatus,
  MatchContext,
  PlaybookSummary,
  DiagnoseResult,
  MatchedPlaybook,
  ProbeRun,
  PortEntry,
  RunActionResult,
  ScanResult,
  LogSourceView,
  LogTail,
  DoctorCheck,
  FixApplyResult,
} from '../types'

/** 自己判定，避免依赖特定版本的导出符号 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 后端访问层。
 *
 * Tauri 环境 → invoke Rust 命令（实时 lsof 扫描）。
 * 纯浏览器（vite dev / 预览）→ 读 public/snapshot.json，
 * 该文件由 scripts/snapshot.mjs 从真实本机扫描生成，所以预览里看到的
 * 仍然是本机真实状态，而不是假数据。
 */
export async function scanServices(): Promise<ScanResult> {
  if (isTauri()) {
    const result = await invoke<ScanResult>('scan_services')
    return { ...result, source: 'tauri' }
  }
  return loadSnapshot()
}

export async function scanPorts(): Promise<PortEntry[]> {
  if (isTauri()) {
    return invoke<PortEntry[]>('scan_ports')
  }
  const snap = await loadSnapshot()
  return snap.ports
}

export async function previewAction(
  serviceId: string,
  action: string
): Promise<ActionPreview> {
  if (!isTauri()) {
    return {
      service_id: serviceId,
      action,
      effective_action: action,
      danger: 'none',
      requires_confirm: false,
      sudo_required: false,
      command: '[浏览器预览模式] 启停需要 Tauri 运行环境，请用 pnpm tauri:dev 启动',
      cwd: '',
      rerouted: null,
      note: null,
      wrap: 'none',
      wrap_reason: null,
      wrapped_command: '',
    }
  }
  return invoke<ActionPreview>('preview_action', { serviceId, action })
}

export async function runAction(
  serviceId: string,
  action: string,
  confirmed: boolean
): Promise<RunActionResult> {
  if (!isTauri()) {
    throw new Error('启停需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  return invoke<RunActionResult>('run_action', { serviceId, action, confirmed })
}

async function loadSnapshot(): Promise<ScanResult> {
  const res = await fetch('snapshot.json')
  if (!res.ok) {
    throw new Error('未找到 snapshot.json，请先运行 `pnpm snapshot`')
  }
  const data = (await res.json()) as ScanResult
  return { ...data, source: 'snapshot' }
}

// ───────────────────────────── Playbook 引擎（V0.2） ─────────────────────────────

export async function listPlaybooks(): Promise<PlaybookSummary[]> {
  if (!isTauri()) return []
  return invoke<PlaybookSummary[]>('list_playbooks')
}

export async function runProbes(): Promise<ProbeRun[]> {
  if (!isTauri()) return []
  return invoke<ProbeRun[]>('run_probes')
}

export async function matchPlaybooks(ctx: MatchContext): Promise<MatchedPlaybook[]> {
  if (!isTauri()) return []
  return invoke<MatchedPlaybook[]>('match_playbooks', { ctx })
}

export async function diagnosePlaybook(id: string): Promise<DiagnoseResult> {
  if (!isTauri()) {
    throw new Error('诊断需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  return invoke<DiagnoseResult>('diagnose_playbook', { id })
}

/** V0.3 一键修复。confirmed=false 且剧本需确认时只返回 needs_confirm，不执行写动作。 */
export async function applyFix(id: string, confirmed: boolean): Promise<FixApplyResult> {
  if (!isTauri()) {
    throw new Error('修复需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  return invoke<FixApplyResult>('apply_fix', { id, confirmed })
}

// ───────────────────────────── 日志中心（V0.2） ─────────────────────────────

export async function listLogSources(serviceId: string): Promise<LogSourceView[]> {
  if (!isTauri()) return []
  return invoke<LogSourceView[]>('list_log_sources', { serviceId })
}

export async function tailLogs(
  serviceId: string,
  lines = 200
): Promise<LogTail[]> {
  if (!isTauri()) return []
  return invoke<LogTail[]>('tail_logs', { serviceId, lines })
}

export async function rotateLog(
  serviceId: string,
  sourceId: string
): Promise<string> {
  if (!isTauri()) {
    throw new Error('旋转需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  return invoke<string>('rotate_log', { serviceId, sourceId })
}

// ───────────────────────────── 环境体检 Doctor ─────────────────────────────

export async function runDoctor(): Promise<DoctorCheck[]> {
  if (!isTauri()) return []
  return invoke<DoctorCheck[]>('run_doctor')
}

/**
 * 把当前整体健康结论同步到托盘（常驻后台时一眼可见）。
 * level 决定菜单栏图标颜色：ok=绿 / warn=琥珀 / fail=红。
 */
export async function updateTrayStatus(
  status: string,
  level: 'ok' | 'warn' | 'fail' = 'ok'
): Promise<void> {
  if (!isTauri()) return
  await invoke('update_tray_status', { status, level })
}

// ───────────────────────────── L2 HTTP 探针（V0.6） ─────────────────────────────

export async function runL2Probe(serviceId: string): Promise<L2ProbeStatus> {
  if (!isTauri()) {
    throw new Error('L2 探针需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  return invoke<L2ProbeStatus>('run_l2_probe', { serviceId })
}
