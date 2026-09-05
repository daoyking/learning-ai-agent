import type { L3Summary } from '../types'

/**
 * L3 结果的本地持久化。
 *
 * 为什么需要：全量 L3 要跑 122s（真发请求、跑推理、冷启动 CLI），
 * 每次开窗口都重跑太重。存下来下次直接显示。
 *
 * 为什么必须带时间戳：这是健康监控工具，把两天前的结果当「当前状态」
 * 展示就是 bug —— 服务可能早就变了。所以存 at、标明年龄、过期变琥珀色。
 */

const KEY = 'lsh.l3.v1'

/** 超过这个时长就标记为「可能已过期」，UI 转琥珀色（结果仍是真实的，只是不确定） */
export const L3_STALE_MS = 30 * 60 * 1000

interface Snapshot {
  v: 1
  map: Record<string, L3Summary>
}

/** 防御式读取：localStorage 里的内容可能被手改、被旧版本写坏，绝不能让它搞崩界面 */
export function loadL3(): Record<string, L3Summary> | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const map = (parsed as Snapshot).map
    if (!map || typeof map !== 'object') return null

    // 逐条校验形状，任何一条不合法就整批丢弃（半截脏数据比没有数据更危险）
    const out: Record<string, L3Summary> = {}
    for (const [id, s] of Object.entries(map)) {
      if (!s || typeof s !== 'object') return null
      if (typeof s.total !== 'number' || typeof s.pass !== 'number') return null
      if (typeof s.ok !== 'boolean' || !Array.isArray(s.runs)) return null
      if (typeof s.at !== 'number' || !Number.isFinite(s.at)) return null
      out[id] = s
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

export function saveL3(map: Record<string, L3Summary>): void {
  try {
    const snap: Snapshot = { v: 1, map }
    window.localStorage.setItem(KEY, JSON.stringify(snap))
  } catch {
    // 配额满或隐私模式禁写：缓存失败不影响主流程，静默跳过
  }
}

export function clearL3(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}

/** 把时间戳格式化成人话年龄：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 */
export function formatAge(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}
