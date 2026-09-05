import { invoke } from '@tauri-apps/api/core'
import type {
  ActionPreview,
  L2ProbeStatus,
  L3Summary,
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

/** 运行所有服务的 L2 HTTP 探针，返回 {serviceId: L2ProbeStatus} 映射 */
export async function runAllL2Probes(): Promise<Record<string, L2ProbeStatus>> {
  if (!isTauri()) {
    return {}
  }
  const pairs = await invoke<Array<[string, L2ProbeStatus]>>('run_all_l2_probes')
  const result: Record<string, L2ProbeStatus> = {}
  for (const [serviceId, status] of pairs) {
    result[serviceId] = status
  }
  return result
}

// ───────────────────────────── L3 语义探针（V0.8） ─────────────────────────────

/** 运行全部 L3 语义探针，返回原始结果列表 */
export async function runProbes(): Promise<ProbeRun[]> {
  if (!isTauri()) {
    return []
  }
  return invoke<ProbeRun[]>('run_probes')
}

/**
 * 把一批探针结果按服务聚合。
 *
 * L3 是「假活」的终极防线：端口通（L1）、HTTP 200（L2）都不代表服务真能用，
 * 只有真正发一次请求、拿到正确结果才算通过。
 */
export function summarizeL3(runs: ProbeRun[]): Record<string, L3Summary> {
  const result: Record<string, L3Summary> = {}
  for (const run of runs) {
    const summary = (result[run.service] ??= {
      pass: 0,
      total: 0,
      ok: true,
      runs: [],
      ms: 0,
    })
    summary.total += 1
    if (run.ok) summary.pass += 1
    else summary.ok = false
    // 后端已在调用侧统一计时，直接累加即可（探针自报的 ms 不可靠）
    summary.ms += run.ms
    summary.runs.push(run)
  }
  return result
}

/** 运行全部 L3 语义探针并按服务聚合 */
export async function runAllL3Probes(): Promise<Record<string, L3Summary>> {
  return summarizeL3(await runProbes())
}

/**
 * 只跑单个服务的 L3 探针（卡片「深检」按钮）。
 *
 * 全量 L3 要 30–90s（openclaw 插件体检光 CLI 冷启动就 60s+），
 * 单服务重跑才有可交互的粒度。该服务没声明探针时返回 null。
 */
export async function runServiceL3Probes(
  serviceId: string
): Promise<L3Summary | null> {
  if (!isTauri()) {
    throw new Error('L3 探针需要 Tauri 运行环境，请用 pnpm tauri:dev 启动')
  }
  const runs = await invoke<ProbeRun[]>('run_service_probes', { serviceId })
  return summarizeL3(runs)[serviceId] ?? null
}
