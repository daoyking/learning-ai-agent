#!/usr/bin/env node
/**
 * L3: SearXNG 到底能不能搜到正常结果。
 *
 * 为什么需要它：/healthz 返回 200、搜索接口返回 200、
 * 结果数量也不为 0 —— 但内容可能是本地化垃圾页。
 * 这是本机实测撞到的真事：搜 "test" 第一条返回汉语词典页。
 *
 * 输出：{ results, localized, localized_ratio, sample_titles[], lang, ms }
 * 断言：results > 0 and localized == false
 */
import { getJson, out, bail, isListening, isLocalizedResult, env } from './_lib.mjs'

const PORT = Number(env('LSH_SEARXNG_PORT', 8081))
const QUERY = env('LSH_SEARXNG_QUERY', 'typescript generics official documentation')
const BASE = `http://127.0.0.1:${PORT}`

if (!(await isListening(PORT))) {
  bail(`端口 ${PORT} 没有进程监听`, { results: 0, localized: false })
}

const { status, json, ms } = await getJson(
  `${BASE}/search?q=${encodeURIComponent(QUERY)}&format=json&language=en-US`,
  { timeout: 30000 }
)

if (status !== 200) {
  // 常见原因：settings.yml 的 search.formats 没开 json
  bail(`搜索接口返回 ${status}（若非 200 请检查 settings.yml 的 search.formats 是否含 json）`, {
    results: 0,
    localized: false,
    status,
  })
}

const results = json?.results ?? []
const sampleTitles = results.slice(0, 5).map((r) => r.title ?? '')

let localizedCount = 0
for (const r of results) {
  if (isLocalizedResult(r.url ?? '', r.title ?? '')) localizedCount++
}

const localizedRatio = results.length > 0 ? localizedCount / results.length : 0

out({
  ok: results.length > 0 && localizedRatio < 0.5,
  results: results.length,
  localized: localizedRatio >= 0.5,
  localized_count: localizedCount,
  localized_ratio: Number(localizedRatio.toFixed(2)),
  sample_titles: sampleTitles,
  query: QUERY,
  ms,
})
