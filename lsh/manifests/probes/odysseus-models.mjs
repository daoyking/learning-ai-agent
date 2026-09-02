#!/usr/bin/env node
/**
 * L3 探针：Odysseus 模型清单是否"真的有模型"
 *
 * 断言（manifest）：total > 0
 *
 * 为什么需要这个探针：
 *   GET /api/models 读的是内存缓存（_MODELS_CACHE_TTL = 30s），端点还没注册完
 *   时它会返回 {hosts: [], items: [...offline]}，UI 上看起来就是"没有模型"。
 *   但此时 /api/model-endpoints/{id}/models 往往已经能吐出真实清单。
 *   顶层接口的 0 不等于真的没有模型 —— 这就是要穿透的原因。
 *
 * 凭据：LSH_ODYSSEUS_TOKEN 或 LSH_ODYSSEUS_USER/PASS（见 _lib.mjs）
 */
import { out, bail, getJson, isListening, env, odysseusAuth } from './_lib.mjs'

const BASE = env('LSH_ODYSSEUS_BASE', 'http://127.0.0.1:7001')
const PORT = Number(env('LSH_ODYSSEUS_PORT', '7001'))

if (!(await isListening(PORT))) {
  bail('gateway_not_listening', { running: false, port: PORT })
}

const auth = await odysseusAuth(BASE)
if (!auth) {
  bail('needs_credentials', {
    running: true,
    hint: 'export LSH_ODYSSEUS_USER=... LSH_ODYSSEUS_PASS=... （或 LSH_ODYSSEUS_TOKEN=ody_...）',
  })
}
if (auth.error) {
  bail('auth_failed', { running: true, error: auth.error })
}

const H = auth.headers
const t0 = Date.now()

/** /api/models → {hosts, items:[{models, models_extra, endpoint_id, offline}]} */
const top = await getJson(`${BASE}/api/models?background=false`, { timeout: 15000, headers: H })
if (top.status !== 200) {
  out({
    ok: false,
    running: true,
    error: `GET /api/models HTTP ${top.status}: ${top.text.slice(0, 200)}`,
    ms: Date.now() - t0,
  })
}

const items = top.json?.items ?? []
const countModels = (it) =>
  (Array.isArray(it.models) ? it.models.length : 0) +
  (Array.isArray(it.models_extra) ? it.models_extra.length : 0)

let total = 0
let online = 0
let offline = 0
const endpoints = []
for (const it of items) {
  const n = countModels(it)
  total += n
  if (it.offline) offline += 1
  else online += 1
  endpoints.push({
    id: it.endpoint_id,
    name: it.endpoint_name,
    kind: it.endpoint_kind,
    type: it.model_type,
    url: it.url,
    models: n,
    offline: Boolean(it.offline),
  })
}

const result = {
  running: true,
  mode: auth.mode,
  total,
  endpoints_total: items.length,
  endpoints_online: online,
  endpoints_offline: offline,
  ms: Date.now() - t0,
}

/**
 * 顶层报 0 时不直接判死 —— 穿透到每个端点的 /models 子接口再确认一次。
 * 这个接口 require_admin，token 模式下拿不到，要如实标注 degraded。
 */
if (total === 0 && items.length > 0) {
  const drilled = []
  for (const ep of endpoints.slice(0, 6)) {
    if (!ep.id) continue
    const sub = await getJson(`${BASE}/api/model-endpoints/${encodeURIComponent(ep.id)}/models`, {
      timeout: 12000,
      headers: H,
    })
    if (sub.status === 403) {
      result.drill_error = 'require_admin：当前凭据不是管理员，无法穿透端点'
      break
    }
    const list = sub.json?.models ?? sub.json?.model_ids ?? (Array.isArray(sub.json) ? sub.json : [])
    drilled.push({ id: ep.id, name: ep.name, sub_models: Array.isArray(list) ? list.length : 0 })
  }
  result.drilled = drilled
  result.drill_total = drilled.reduce((a, b) => a + b.sub_models, 0)
  result.total = result.drill_total
  result.recovered_by_drilldown = result.drill_total > 0
}

result.ok = result.total > 0
out(result)
