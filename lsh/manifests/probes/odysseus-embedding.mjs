#!/usr/bin/env node
/**
 * L3 探针：Odysseus 的 embedding lane 是否真的能用
 *
 * 断言（manifest）：lanes > 0
 *
 * 为什么需要这个探针：
 *   EMBEDDING_URL / EMBEDDING_MODEL 没配或配错时，服务照常启动、
 *   /api/health 照常 200、聊天照常能用 —— 只有 RAG / 记忆检索全废，
 *   而且症状是"搜不到东西"而不是"报错"。这是最典型的静默假活。
 *
 * 本探针分两层：
 *   1) 配置层：/api/embeddings/endpoint 读出当前 URL + model
 *   2) 事实层：直接向该 endpoint 打一条真实 embedding 请求，看向量维度
 *  只有两层都过才算 healthy —— 配置写了但端点死了，UI 必须报琥珀而不是绿。
 *
 * 注意：/api/embeddings/* 挂了 require_admin，ody_ token 走不通。
 */
import { out, bail, getJson, postJson, isListening, env, odysseusAuth } from './_lib.mjs'

const BASE = env('LSH_ODYSSEUS_BASE', 'http://127.0.0.1:7001')
const PORT = Number(env('LSH_ODYSSEUS_PORT', '7001'))

if (!(await isListening(PORT))) {
  bail('gateway_not_listening', { running: false, port: PORT })
}

const auth = await odysseusAuth(BASE)
if (!auth) {
  bail('needs_credentials', {
    running: true,
    hint: 'export LSH_ODYSSEUS_USER=... LSH_ODYSSEUS_PASS=...（embedding 路由 require_admin，ody_ token 不够）',
  })
}
if (auth.error) bail('auth_failed', { running: true, error: auth.error })

const H = auth.headers
const t0 = Date.now()

const cfg = await getJson(`${BASE}/api/embeddings/endpoint`, { timeout: 10000, headers: H })
if (cfg.status !== 200) {
  // 403 基本等于"用了 ody_ token" —— 明确告诉用户换凭据，而不是报"没配"
  out({
    ok: false,
    running: true,
    lanes: 0,
    error: `GET /api/embeddings/endpoint HTTP ${cfg.status}: ${cfg.text.slice(0, 200)}`,
    hint: cfg.status === 403 ? '该路由 require_admin，请改用管理员账号密码（LSH_ODYSSEUS_USER/PASS）' : undefined,
    ms: Date.now() - t0,
  })
}

const url = cfg.json?.url ?? ''
const model = cfg.json?.model ?? ''
const configured = Boolean(url)

const result = {
  running: true,
  mode: auth.mode,
  configured,
  url: url || null,
  model: model || null,
  lanes: 0,
  ms: Date.now() - t0,
}

if (!configured) {
  // 配置层都没通过，直接判失败，别浪费一次网络请求
  result.error = 'EMBEDDING_URL 未配置 —— 服务能起，但 RAG / 记忆检索全部静默失效'
  result.ok = false
  out(result)
}

/**
 * 事实层：真的发一条 embedding 请求。
 * 走 /v1/embeddings（OpenAI 兼容），Ollama 与大多数本地推理端都认这个形状。
 */
const probeUrl = url.replace(/\/+$/, '')
const body = { model, input: 'lsh embedding lane probe' }

let emb
try {
  emb = await postJson(probeUrl, body, { timeout: 20000 })
} catch (e) {
  result.error = `embedding endpoint 不可达: ${String(e.message ?? e)}`
  result.ok = false
  out(result)
}

result.endpoint_status = emb.status
result.endpoint_ms = emb.ms

const data = emb.json?.data
const vec = Array.isArray(data) ? data[0]?.embedding : null
if (emb.status === 200 && Array.isArray(vec) && vec.length > 0) {
  result.lanes = 1
  result.dims = vec.length
  result.ok = true
} else {
  const detail =
    emb.json?.error?.message ?? emb.json?.error ?? emb.json?.detail ?? emb.text?.slice(0, 200) ?? ''
  result.error = `embedding 请求失败（HTTP ${emb.status}）: ${String(detail).slice(0, 240)}`
  result.ok = false
}

out(result)
