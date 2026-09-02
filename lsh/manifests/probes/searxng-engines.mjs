#!/usr/bin/env node
/**
 * L3: 已启用的引擎里有多少个真能返回结果。
 *
 * 本机实测：ddg / google / brave / startpage 从本机出口全被封，
 * 只有 bing / mojeek / wikipedia / marginalia 可用。
 * 引擎全被封时结果必然为 0，但 SearXNG 自己不会报错。
 *
 * 输出：{ alive, total, per_engine: {name: resultCount}, ms }
 * 断言：alive >= 2
 */
import { getJson, out, bail, isListening, env } from './_lib.mjs'

const PORT = Number(env('LSH_SEARXNG_PORT', 8081))
const BASE = `http://127.0.0.1:${PORT}`
const QUERY = env('LSH_SEARXNG_QUERY', 'opensource vector database')

// 本机实测可用与已知被封的引擎。逐个测，别猜。
const ENGINES = (env('LSH_SEARXNG_ENGINES', 'bing,mojeek,wikipedia,marginalia,duckduckgo,google,brave,startpage') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!(await isListening(PORT))) {
  bail(`端口 ${PORT} 没有进程监听`, { alive: 0, total: ENGINES.length })
}

const perEngine = {}
let alive = 0

await Promise.all(
  ENGINES.map(async (engine) => {
    try {
      const { json, status } = await getJson(
        `${BASE}/search?q=${encodeURIComponent(QUERY)}&format=json&engines=${engine}`,
        { timeout: 25000 }
      )
      const n = status === 200 ? (json?.results ?? []).length : 0
      perEngine[engine] = n
      if (n > 0) alive += 1
    } catch {
      perEngine[engine] = 0
    }
  })
)

out({
  ok: alive >= 2,
  alive,
  total: ENGINES.length,
  per_engine: perEngine,
  query: QUERY,
})
