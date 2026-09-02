#!/usr/bin/env node
/**
 * L3: OmniRoute 的供应商到底能不能用。
 *
 * 核心教训（本机 2026-09-02 实测，血淋淋的）：
 *   /v1/models 返回 5677 个模型、DB 里 22 个供应商 is_active=1 ——
 *   但逐个看 test_status，真正 active 的只有 1 个。
 *   其余是：credits_exhausted(402) / expired(401) / 502 / network_error。
 *
 *   is_active 只表示"配置里勾上了"，不表示凭据有效、也不表示有额度。
 *   所以判断可用性只有一条路：真的发一条请求，拿到内容。
 *
 * 输出：
 *   live            —— 端到端实发请求成功的数量（唯一作数的判据）
 *   really_active   —— DB 里 test_status='active' 且无 error_code 的数量
 *   db_active       —— DB 里 is_active=1 的数量（不可信，仅作对照）
 *   breakdown       —— 按失败原因分组计数（这是给用户看"为什么"的）
 *
 * 断言：live > 0
 */
import { postJson, getJson, out, bail, isListening, env } from './_lib.mjs'

const PORT = Number(env('LSH_OMNIROUTE_PORT', 20128))
const BASE = `http://127.0.0.1:${PORT}`
const DB = env('LSH_OMNIROUTE_DB', `${process.env.HOME}/.omniroute/storage.sqlite`)
const E2E_TIMEOUT = Number(env('LSH_OMNIROUTE_TIMEOUT', 30000))

if (!(await isListening(PORT))) {
  bail(`端口 ${PORT} 没有进程监听`, { live: 0 })
}

// ---------- ① 读 DB：状态分布（只作证据，不作结论） ----------
let rows = []
let dbError = null
try {
  const { DatabaseSync } = await import('node:sqlite')
  const conn = new DatabaseSync(DB)
  rows = conn
    .prepare(
      `SELECT provider, name, is_active, test_status, error_code, last_error, proxy_enabled
       FROM provider_connections`
    )
    .all()
} catch (e) {
  dbError = String(e.message ?? e)
}

const breakdown = {}
let dbActive = 0
let reallyActive = 0

for (const r of rows) {
  if (r.is_active === 1) dbActive += 1

  const healthy = r.test_status === 'active' && !r.error_code
  if (healthy) reallyActive += 1

  // 失败原因归类：优先用语义化的 test_status，退化到 error_code
  const key = healthy ? 'active' : String(r.test_status ?? r.error_code ?? 'unknown')
  breakdown[key] = (breakdown[key] ?? 0) + 1
}

const healthyProviders = rows
  .filter((r) => r.test_status === 'active' && !r.error_code)
  .map((r) => r.provider)
  .filter(Boolean)

// ---------- ② 挑一个"DB 说它健康"的供应商，端到端真发一条请求 ----------
// 优先用已知健康供应商的模型；找不到再退回 auto/best-coding
let candidateModels = []

if (healthyProviders.length > 0) {
  try {
    const { json } = await getJson(`${BASE}/v1/models`, { timeout: 15000 })
    const ids = (json?.data ?? []).map((m) => m.id)
    for (const p of healthyProviders) {
      const hit = ids.find((id) => id === p || id.startsWith(`${p}/`))
      if (hit) candidateModels.push(hit)
    }
  } catch {
    /* 拿不到模型列表就走 fallback */
  }
}
if (candidateModels.length === 0) {
  candidateModels.push(env('LSH_OMNIROUTE_MODEL', 'auto/best-coding'))
}
candidateModels = [...new Set(candidateModels)].slice(0, 3)

// ---------- ③ 并发探测，取最先成功的那个 ----------
const attempts = []
let live = 0
let firstOk = null

await Promise.all(
  candidateModels.map(async (model) => {
    const started = Date.now()
    try {
      const { status, json, text } = await postJson(
        `${BASE}/v1/chat/completions`,
        {
          model,
          messages: [{ role: 'user', content: 'reply exactly: PONG' }],
          max_tokens: 8,
          stream: false,
        },
        { timeout: E2E_TIMEOUT }
      )
      const content = json?.choices?.[0]?.message?.content ?? ''
      const ok = status === 200 && content.trim().length > 0
      attempts.push({
        model,
        ok,
        ms: Date.now() - started,
        error: ok ? null : `HTTP ${status}: ${String(text).slice(0, 160)}`,
        reply: content.slice(0, 60) || null,
      })
      if (ok && !firstOk) firstOk = { model, ms: Date.now() - started, reply: content.slice(0, 60) }
    } catch (e) {
      attempts.push({
        model,
        ok: false,
        ms: Date.now() - started,
        error: String(e.message ?? e).slice(0, 160),
        reply: null,
      })
    }
  })
)

live = attempts.filter((a) => a.ok).length

// ---------- ④ 幽灵代理检测（DB 开代理但端口没人的经典场景） ----------
const proxyPort = Number(env('LSH_PROXY_PORT', 7890))
const proxyAlive = await isListening(proxyPort)
const proxyEnabledCount = rows.filter((r) => r.proxy_enabled === 1).length

let hint = null
if (live === 0 && proxyEnabledCount > 0 && !proxyAlive) {
  hint = '幽灵代理：DB 里开着代理，但代理端口无监听者 → playbook omniroute-ghost-proxy'
} else if (live === 0 && reallyActive === 0) {
  hint = `没有健康供应商：${Object.entries(breakdown)
    .filter(([k]) => k !== 'active')
    .map(([k, v]) => `${k}×${v}`)
    .join('、')}。这是凭据/额度问题，不是网络问题 —— 别去改代理配置。`
} else if (live === 0 && reallyActive > 0) {
  hint = `DB 显示 ${reallyActive} 个供应商健康，但实发请求全失败 —— 说明 DB 状态同样不可信，需要查网络与上游。`
}

out({
  ok: live > 0,
  live,
  e2e_ok: live > 0,
  e2e_model: firstOk?.model ?? null,
  e2e_ms: firstOk?.ms ?? -1,
  e2e_reply: firstOk?.reply ?? null,
  attempts,

  // 三个数字的对比就是本探针的价值所在
  db_active: dbActive,          // is_active=1（不可信）
  really_active: reallyActive,  // test_status=active 且无 error（较可信）
  total: rows.length,
  breakdown,                    // 失败原因分布
  healthy_providers: healthyProviders.slice(0, 8),

  proxy_port: proxyPort,
  proxy_alive: proxyAlive,
  proxy_enabled_count: proxyEnabledCount,
  hint,
  db_error: dbError,
})
