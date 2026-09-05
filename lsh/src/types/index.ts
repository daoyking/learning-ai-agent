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

/** L2 HTTP 探针结果（curl 健康检查） */
export interface L2ProbeStatus {
  ok: boolean
  status: number
  expect_status: number
  ms: number
}

/** L3 语义探针单次运行结果（V0.8） */
export interface ProbeRun {
  service: string
  probe: string
  /** manifest 声明的人类可读描述 */
  desc: string | null
  ok: boolean
  /** 失败时的错误串；成功时是原始 JSON 串 */
  raw: string
  /** 探针返回的完整值（含 result / error / model 等），结构随探针类型而异 */
  vars: Record<string, unknown> | null
  /** 墙钟耗时（ms），由后端在调用侧统一测量 */
  ms: number
}

/** 单个服务的 L3 语义探针汇总 */
export interface L3Summary {
  /** 通过的探针数 */
  pass: number
  /** 声明的探针总数 */
  total: number
  /** 全部通过 */
  ok: boolean
  /** 明细，用于抽屉/展开查看 */
  runs: ProbeRun[]
  /** 服务整体耗时（所有探针 ms 之和，缺失时记 0） */
  ms: number
  /**
   * 这份结果的产生时刻（Date.now()）。
   *
   * L3 结果会被持久化复用，但对健康监控来说「多久之前测的」和「测得怎么样」
   * 同样重要 —— 两小时前的绿灯不能当成现在的绿灯。
   */
  at: number
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
  /** L2 HTTP 探针结果（手动触发时填充，启动时不运行） */
  l2_status: L2ProbeStatus | null
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
  /** none | setsid | pty —— 长任务的进程包装方式 */
  wrap: 'none' | 'setsid' | 'pty'
  /** 为什么这么包装（直接展示给用户，避免"我写的是 A 你跑的是 B"的困惑） */
  wrap_reason: string | null
  /** 包装后的完整命令回显 */
  wrapped_command: string
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
  wrap: 'none' | 'setsid' | 'pty'
  wrap_reason: string | null
  wrapped_command: string
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

export interface FixStepOut {
  id: string
  title: string
  kind: string
  command: string
  output: string | null
  exit: number | null
  error: string | null
  skipped: boolean
  skip_reason: string | null
  rolled_back: boolean
}

export interface VerifyOut {
  passed: boolean
  detail: string
}

export interface FixApplyResult {
  executed: boolean
  needs_confirm: boolean
  rejected_sudo: boolean
  mode: string
  steps: FixStepOut[]
  verify: VerifyOut | null
  rollback_note: string | null
}

// ───────────────────────────── 日志中心（V0.2：聚合尾部 + 大小体检 + 旋转） ─────────────────────────────

export interface RotateView {
  max_size: string
  max_bytes: number
  keep: number
  strategy: string
}

export interface LogSourceView {
  service_id: string
  source_id: string
  kind: string
  path: string | null
  container: string | null
  command: string | null
  label: string | null
  rotate: RotateView | null
  ignore_patterns: string[]
}

export interface LogTail {
  source_id: string
  kind: string
  target: string
  lines: string
  truncated_from: number | null
  over_threshold: boolean
  rotate: RotateView | null
  error: string | null
}

// ───────────────────────────── 环境体检 Doctor ─────────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface DoctorCheck {
  id: string
  title: string
  status: CheckStatus
  detail: string
}
