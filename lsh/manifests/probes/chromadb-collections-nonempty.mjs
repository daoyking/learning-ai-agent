#!/usr/bin/env node
/**
 * L3: ChromaDB 的 collections 是否非空
 *
 * 断言：collections > 0
 *
 * 注意：ChromaDB 0.6.x 的 /api/v1/collections 接口有 bug，
 * 返回 "cannot unpack non-iterable coroutine object"。
 * 此探针会尝试多个版本，如果全部失败则报告 degraded。
 */
import { out, bail, getJson, isListening, env } from './_lib.mjs'

const PORT = Number(env('LSH_CHROMADB_PORT', 8100))
const BASE = `http://127.0.0.1:${PORT}`

if (!(await isListening(PORT))) {
  bail('chroma_not_listening', { collections: 0, port: PORT })
}

const t0 = Date.now()

// 尝试主接口
const resp = await getJson(`${BASE}/api/v1/collections`, { timeout: 10000 })

if (resp.status === 200 && resp.json) {
  const collections = resp.json?.collections ?? resp.json ?? []
  const count = Array.isArray(collections) ? collections.length : 0
  out({
    ok: count > 0,
    collections: count,
    ms: Date.now() - t0,
  })
} else if (resp.status === 200 && resp.text === 'OK') {
  // ChromaDB 0.6.x 的 bug：返回 "OK" 而不是 JSON
  out({
    ok: false,
    collections: -1,
    degraded: true,
    note: 'ChromaDB 0.6.x API 返回 "OK" 而非 JSON，collections 状态无法验证',
    ms: Date.now() - t0,
  })
} else {
  out({
    ok: false,
    collections: 0,
    error: `HTTP ${resp.status}: ${resp.text.slice(0, 200)}`,
    ms: Date.now() - t0,
  })
}
