#!/usr/bin/env node
/**
 * L3 探针：Odysseus 联网搜索是否真能出"有用的"结果
 *
 * 断言（manifest）：results > 0
 *
 * 为什么需要这个探针：
 *   SearXNG 容器跑着、端口通、POST /api/search 返回 200，但结果可能是
 *   按出口 IP 猜地区后返回的词典站 / 房产站 / 本地生活站 —— 搜索"能用"，
 *   结果是废的。数量 > 0 不代表搜索活着，相关性才算。
 *
 * 判定口径：
 *   - results:     返回条数
 *   - usable:      剔除本地化垃圾后的条数
 *   - localized_ratio: 垃圾占比
 *   ok = results > 0 且 usable > 0 且 localized_ratio < 0.5
 *
 * 本机事实（2026-09-02 实测）：8 个引擎只有 marginalia 真的返回结果，
 * bing/mojeek/wikipedia/ddg/google/brave/startpage 全是 0。
 * 所以这个探针会同时报告 per_engine，方便一眼看出是"引擎全挂"还是"定位错了"。
 */
import { out, bail, getJson, postJson, isListening, env, odysseusAuth, isLocalizedResult } from './_lib.mjs'

const BASE = env('LSH_ODYSSEUS_BASE', 'http://127.0.0.1:7001')
const PORT = Number(env('LSH_ODYSSEUS_PORT', '7001'))
// 短查询才容易触发本地化污染（长英文 query 反而干净），故意用短词
const QUERY = env('LSH_SEARCH_QUERY', 'large language model inference optimization')

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
if (auth.error) bail('auth_failed', { running: true, error: auth.error })

const H = auth.headers
const t0 = Date.now()

// 先确认 provider 配置状态：SearXNG 没配 URL 的话后面全是空转
const providers = await getJson(`${BASE}/api/search/providers`, { timeout: 8000, headers: H })
const providerList = Array.isArray(providers.json?.providers) ? providers.json.providers : []
const searxng = providerList.find((p) => p.id === 'searxng') ?? null

const search = await postJson(`${BASE}/api/search`, { query: QUERY }, { timeout: 40000, headers: H })

const sources = Array.isArray(search.json?.sources) ? search.json.sources : []
const context = typeof search.json?.context === 'string' ? search.json.context : ''

let usable = 0
const localized = []
const perEngine = {}
for (const s of sources) {
  const url = String(s.url ?? s.link ?? '')
  const title = String(s.title ?? '')
  const engine = String(s.engine ?? (s.metadata ? s.metadata.engine : '') ?? 'unknown')
  perEngine[engine] = (perEngine[engine] ?? 0) + 1
  if (isLocalizedResult(url, title)) localized.push({ url, title })
  else usable += 1
}

const results = sources.length
const localizedRatio = results > 0 ? Number((localized.length / results).toFixed(2)) : 0

out({
  running: true,
  mode: auth.mode,
  query: QUERY,
  results,
  usable,
  localized: localized.length,
  localized_ratio: localizedRatio,
  localized_samples: localized.slice(0, 3),
  per_engine: perEngine,
  context_bytes: context.length,
  search_status: search.status,
  searxng_available: searxng?.available ?? null,
  search_error: search.json?.error ?? null,
  ok: results > 0 && usable > 0 && localizedRatio < 0.5,
  ms: Date.now() - t0,
})
