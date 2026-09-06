#!/usr/bin/env node
/**
 * L3: OpenViking Studio（托管实例）到底开没开门。
 *
 * 为什么需要它：这个域名下**所有路径都返回 200**（2026-09-06 实测）。
 * /health、/api/v1/health、/v1/models、甚至一个不存在的路由，统统 200 ——
 * 因为前面挡着一层 SPA fallback。只有 /studio/health 与 /studio/ready
 * 会真的返回 {"status":"ok"}，其余全是 index.html 的壳。
 *
 * 所以「HTTP 200」在这里毫无信息量。必须三条一起验：
 *   1. /studio/health  → JSON 且 status=ok     （后端自报健康）
 *   2. /studio/ready   → JSON 且 status=ok     （就绪，能接流量）
 *   3. /studio/ 首页   → 含 "OpenViking Studio"（页面壳还在，不是缓存残骸）
 * 三者缺一，都说明这个托管实例处于「部分活着」的状态。
 *
 * ⚠️ 能力边界（故意的）：这只验证**入口**，不验证你的数据面。
 * 会话、记忆、检索是否正常，需要 API key 才能验 —— 没有凭据时
 * 探针会返回 data_plane: 'unverified'，而不是假装验过了。
 *
 * 输出：{ health, ready, shell, data_plane, needs_credentials, ms }
 * 断言：health && ready && shell
 */
import { getJson, out, bail, env } from './_lib.mjs'

const BASE = env('LSH_OPENVIKING_BASE', 'https://openviking.net')
const KEY = env('LSH_OPENVIKING_KEY', null)
const TIMEOUT = Number(env('LSH_OPENVIKING_TIMEOUT', 15000))

/** 打一个端点，返回 {ok, status, body}。连不上/超时都算不 ok，不抛异常。 */
async function probe(path) {
  try {
    const { status, text } = await getJson(`${BASE}${path}`, { timeout: TIMEOUT })
    return { ok: status === 200, status, body: text ?? '' }
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e?.message ?? e) }
  }
}

/** 后端健康端点：必须是 JSON，且 status 字段为 ok */
function jsonOk(body) {
  try {
    const j = JSON.parse(body)
    return j?.status === 'ok'
  } catch {
    return false // 拿到的是 SPA 的 index.html —— 说明这个路径根本没有后端
  }
}

const started = Date.now()
const [health, ready, shell] = await Promise.all([
  probe('/studio/health'),
  probe('/studio/ready'),
  probe('/studio/playground'),
])

const healthOk = health.ok && jsonOk(health.body)
const readyOk = ready.ok && jsonOk(ready.body)
// 页面壳：SPA fallback 也返回 200，所以要认<title>而不是状态码
const shellOk = shell.ok && shell.body.includes('OpenViking Studio')

// 数据面：没有 API key 就明确说没验，绝不返回 true 假装验过
let dataPlane = 'unverified'
if (KEY) {
  dataPlane = 'not_implemented' // 托管实例的检索接口需按账号确认路径后再接
}

const ok = healthOk && readyOk && shellOk

out({
  ok,
  health: healthOk,
  ready: readyOk,
  shell: shellOk,
  // 三条里挂了哪条，直接用 HTTP 状态或内容片段说明，别让用户猜
  detail: {
    health: health.ok ? String(health.status) : `连不上（${health.error ?? health.status}）`,
    ready: ready.ok ? String(ready.status) : `连不上（${ready.error ?? ready.status}）`,
    shell: shell.ok ? (shellOk ? '200 且含标题' : '200 但不是 Studio 页面') : '连不上',
  },
  data_plane: dataPlane,
  needs_credentials: !KEY,
  ms: Date.now() - started,
  note: ok
    ? KEY
      ? null
      : '入口三项全通。但数据面（会话/记忆/检索）未验证 —— 未设置 LSH_OPENVIKING_KEY。'
    : '托管实例没有完全就绪。它在本机没有任何进程，除了等对方恢复你无事可做 —— 这正是把 SaaS 纳入监控的意义：先知道它挂了。',
})
