import { invoke } from '@tauri-apps/api/core'
import type { ActionPreview, PortEntry, RunActionResult, ScanResult } from '../types'

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
