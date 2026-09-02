#!/usr/bin/env node
/**
 * L3: AnythingLLM workspace 里到底有没有文档。
 *
 * 为什么需要它：服务全绿（8888 返回 200）不代表 RAG 能用 ——
 * workspace 里没文档时它照样回答，只是答不出东西。
 *
 * 重要：/api/v1/* 需要 API key。拿不到凭据时必须明确报
 * needs_credentials，绝不返回 documents: 0 假装通过 ——
 * 那是另一种形式的假活（用"看起来正常"的 0 掩盖"根本没测"）。
 *
 * 输出：{ documents, workspaces, needs_credentials, status }
 * 断言：documents > 0
 */
import { getJson, out, bail, isListening, env } from './_lib.mjs'

const PORT = Number(env('LSH_ANYTHINGLLM_PORT', 8888))
const BASE = `http://127.0.0.1:${PORT}`
const KEY = env('LSH_ANYTHINGLLM_KEY', null)

if (!(await isListening(PORT))) {
  bail(`端口 ${PORT} 没有进程监听`, { documents: 0, needs_credentials: false })
}

if (!KEY) {
  // 不给假结果。明确区分"没文档"和"没测"。
  out({
    ok: false,
    documents: -1,
    workspaces: -1,
    needs_credentials: true,
    note: '未设置 LSH_ANYTHINGLLM_KEY，无法查询 workspace。请在 AnythingLLM 设置里生成 API key 后注入环境变量。',
  })
}

const { status, json, text } = await getJson(`${BASE}/api/v1/workspaces`, {
  timeout: 20000,
  headers: { Authorization: `Bearer ${KEY}` },
})

if (status === 401 || status === 403) {
  out({
    ok: false,
    documents: -1,
    workspaces: -1,
    needs_credentials: true,
    status,
    note: 'API key 被拒绝（401/403），请确认 key 有效且未过期',
  })
}

if (status !== 200) {
  out({
    ok: false,
    documents: -1,
    workspaces: -1,
    needs_credentials: false,
    status,
    note: `workspaces 接口返回 ${status}: ${String(text).slice(0, 160)}`,
  })
}

const list = Array.isArray(json) ? json : (json?.workspaces ?? [])
const documents = list.reduce((n, w) => n + (w?.documents?.length ?? w?.documentCount ?? 0), 0)

out({
  ok: documents > 0,
  documents,
  workspaces: list.length,
  needs_credentials: false,
  status,
  note:
    documents === 0
      ? 'workspace 里一份文档都没有 —— 服务是好的，但 RAG 答不出东西。见本机累计 7315 份的基线，0 通常意味着存储卷没挂载。'
      : null,
})
