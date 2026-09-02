/**
 * 与 src-tauri/src/commands.rs 的 Rust 结构一一对应（serde 输出 snake_case）。
 * 改任一侧都要同步另一侧。
 */

export type ServiceStatus = 'running' | 'stopped' | 'unknown'

/**
 * 服务是否处于「被监管」状态。与 status 正交的第二维度：
 *   supervised     —— 崩溃会被自动拉起
 *   unsupervised   —— 进程可能在跑，但没人盯着，崩了即永久停机
 *   not_applicable —— 纯 GUI 应用等本就无监管体系的服务，不报警
 *   unknown        —— 判定失败，绝不当成正常
 */
export type SupervisionState =
  | 'supervised'
  | 'unsupervised'
  | 'not_applicable'
  | 'unknown'

export type SupervisorKind = 'launchd' | 'docker' | 'app' | 'script' | 'pty'

export interface PortEntry {
  port: number
  pid: number
  command: string
  address: string
  loopback_only: boolean
}

export interface PortConflict {
  port: number
  command: string
  pid: number
}

export interface ServiceCard {
  id: string
  name: string
  description: string | null
  category: string
  priority: string
  tags: string[]
  supervisor_kind: SupervisorKind
  /** manifest 里声明的可执行动作：start/stop/restart/status/bootstrap… */
  actions: string[]
  depends_on: string[]
  provides: string[]
  port: number | null
  listening_port: number | null
  pid: number | null
  process: string | null
  status: ServiceStatus
  supervised: SupervisionState
  probe_ms: number
  port_conflict: PortConflict | null
  playbooks: string[]
  l3_count: number
  log_count: number
}

/** preview_action 返回：将要执行的命令 + 安全等级 */
export interface ActionPreview {
  service_id: string
  action: string
  effective_action: string
  danger: 'none' | 'confirm' | 'sudo'
  requires_confirm: boolean
  sudo_required: boolean
  command: string
  cwd: string
  rerouted: string | null
  note: string | null
}

/** run_action 返回：执行结果 / 后台 pid / 捕获的输出 */
export interface RunActionResult {
  service_id: string
  action: string
  effective_action: string
  executed: boolean
  danger: 'none' | 'confirm' | 'sudo'
  requires_confirm: boolean
  sudo_required: boolean
  command: string
  cwd: string
  rerouted: string | null
  output: string | null
  exit_code: number | null
  spawned_pid: number | null
  timed_out: boolean
  note: string | null
  error: string | null
}

export interface ScanResult {
  services: ServiceCard[]
  ports: PortEntry[]
  scanned_at_ms: number
  elapsed_ms: number
  manifest_dirs: string[]
  /** 仅浏览器 fallback 模式下存在：说明数据来自快照而非实时扫描 */
  source?: 'tauri' | 'snapshot'
}

// ───────────────────────────── Playbook 引擎（V0.2：只读诊断 + 结论 + 给命令） ─────────────────────────────

export interface PlaybookSummary {
  id: string
  title: string
  service: string | null
  severity: string
  category: string
  symptom: string | null
  has_fix: boolean
  risk: string
  requires_sudo: boolean
}

/** match_playbooks 的入参：注入触发器的探针变量（由 run_probes 产出） */
export interface MatchContext {
  probe_vars: Record<string, unknown>
  home: string
}

export interface MatchedPlaybook {
  id: string
  title: string
  service: string | null
  severity: string
  category: string
  symptom: string | null
  trigger_summary: string
  notes: string[]
}

export interface DiagnoseStepOut {
  id: string
  title: string
  cmd: string | null
  output: string
  exit: number
  captured: unknown | null
  error: string | null
  /** 该步骤是否可选（失败不会阻断诊断） */
  optional: boolean
}

export interface ConclusionOut {
  when: string
  root_cause: string
  confidence: 'low' | 'medium' | 'high'
  evidence: string[]
  recommended_fix: string | null
  matched: boolean
}

export interface FixStepPreview {
  id: string
  title: string
  kind: string
  command: string
  snapshot: boolean
}

export interface FixPreview {
  mode: string
  confirm: boolean
  risk: string
  side_effects: string
  requires_sudo: boolean
  steps: FixStepPreview[]
}

export interface DiagnoseResult {
  id: string
  title: string
  severity: string
  category: string
  symptom: string | null
  source: string | null
  steps: DiagnoseStepOut[]
  vars: unknown
  partial: boolean
  conclusions: ConclusionOut[]
  fix: FixPreview | null
}

export interface ProbeRun {
  service: string
  probe: string
  ok: boolean
  raw: string
  vars: unknown
}
