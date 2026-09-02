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

export interface ScanResult {
  services: ServiceCard[]
  ports: PortEntry[]
  scanned_at_ms: number
  elapsed_ms: number
  manifest_dirs: string[]
  /** 仅浏览器 fallback 模式下存在：说明数据来自快照而非实时扫描 */
  source?: 'tauri' | 'snapshot'
}
