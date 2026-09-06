#!/usr/bin/env node
/**
 * L3: OpenViking 本地实例 —— 真的写一条资源，再真的检索回来。
 *
 * 为什么需要它：/health 返回 200 只说明 uvicorn 活着。这台机器上
 * OpenViking 由三个部件串起来：Ollama(bge-m3) 做 embedding、
 * Ollama(qwen3:14b) 做 L0/L1 摘要、viking:// 索引做检索。
 * 任何一环断了，服务照样返回 200，检索却一条都出不来。
 *
 * 所以判据只有一条：**写进去的东西能被查出来**。
 *
 * 链路：
 *   1. POST /api/v1/resources/temp_upload  上传夹具（服务端拒绝本地路径，
 *      必须先走 temp_upload 拿 temp_file_id —— 实测直接传 path 会
 *      PERMISSION_DENIED）
 *   2. POST /api/v1/resources              入库（wait:false，自己轮询，
 *      否则 VLM 摘要慢时会把整个探针挂住）
 *   3. 轮询 search 直到命中                 ← 唯一判据
 *
 * ⚠️ 别拿 fs/ls 的 abstract 字段当"处理完成"的信号 —— 实测它一直为空，
 *    而索引里的摘要早就生成了（检索结果里带 abstract）。拿它做判据会让
 *    探针在链路其实通的情况下误报失败。判据只能是"查得出来"。
 *
 * 夹具用 zanthoxylum（花椒属拉丁学名）做标记词：日常语料里极罕见，
 * 命中它就说明召回的确实是刚写进去的那条，而不是碰巧相关的别的内容。
 *
 * 输出：{ hit, score, abstract_ms, total_ms, written, needs_credentials }
 * 断言：hit == true
 */
import { getJson, postJson, out, bail, env, fetchWithTimeout } from './_lib.mjs'

const BASE = env('LSH_OPENVIKING_URL', 'http://127.0.0.1:1933')
const MARK = env('LSH_OPENVIKING_MARK', 'zanthoxylum')
const DIR = 'viking://resources/lsh-probe'
// 每轮换一个文件名：URI 唯一，才能确保检索到的是**这一轮**写进去的东西。
// 固定 URI 的写法会被上一轮留在索引里的旧条目满足（实测 154ms 就"通过"了，
// 其实那轮根本还没处理完）—— 那是另一种假活：探针绿了，但验证的是旧数据。
const FILENAME = `lsh-probe-${Date.now()}.md`
const TARGET = `${DIR}/${FILENAME}`
// VLM 摘要是这条链路的瓶颈：一个资源要触发 3 次 VLM（文件摘要 +
// 父目录 .abstract + .overview），14B 模型单次 40s 起，排队后实测 3-5 分钟。
// 所以预算给到 7 分钟，且 manifest 里默认 enabled: false（不进全量体检）。
const RECALL_BUDGET_MS = Number(env('LSH_OPENVIKING_BUDGET', 420000))
const POLL_MS = 8000

// 每轮带时间戳，保证内容真的变了 —— 否则内容相同会被判为无变更而跳过
// 处理，探针就退化成"索引里还有上次那条"，发现不了"现在写入坏了"。
const STAMP = new Date().toISOString()
const FIXTURE = `# LSH 语义探针固定夹具

这是 LSH 的 L3 语义探针写入的夹具资源，用于验证 OpenViking 的
写入 → 向量化 → 检索链路真的通了，而不只是端口通。

唯一标记词：${MARK}（花椒属拉丁学名，日常语料里极罕见）。
本轮写入时间：${STAMP}
`

const started = Date.now()

// ── 0. 服务在吗 ────────────────────────────────────────────────
try {
  const { status } = await getJson(`${BASE}/health`, { timeout: 8000 })
  if (status !== 200) bail(`/health 返回 ${status}`, { hit: false })
} catch (e) {
  bail(`连不上 ${BASE}/health：${e?.message ?? e}`, { hit: false })
}

// ── 1. 上传夹具 ────────────────────────────────────────────────
async function upload() {
  const form = new FormData()
  form.append('file', new Blob([FIXTURE], { type: 'text/markdown' }), 'lsh-probe-fixture.md')
  const { res } = await fetchWithTimeout(`${BASE}/api/v1/resources/temp_upload`, {
    method: 'POST',
    body: form,
    timeout: 20000,
  })
  const j = await res.json().catch(() => null)
  return j?.result?.temp_file_id ?? null
}

// ── 2. 入库 ────────────────────────────────────────────────────
// 固定写同一个 URI：覆盖写，不会把库塞满垃圾。
// 曾经在这里先 DELETE 再写，结果 DELETE 没生效（目录非空/需递归），
// 反而引入竞态，去掉即可 —— 内容每轮带时间戳，本来就会重新处理。
async function add(tempFileId) {
  let lastErr = null
  // 409 CONFLICT / path_busy 是服务端"上一批写入还在处理"的正常答复
  // （自带 retryable: true）。服务正忙 ≠ 服务坏了，等一下再来。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { status, json, text } = await postJson(`${BASE}/api/v1/resources`, {
      temp_file_id: tempFileId,
      to: TARGET,
      wait: false, // 摘要是异步的，自己轮询，别把探针挂死
      create_parent: true,
    }, { timeout: 30000 })
    if (status === 200) return json

    lastErr = `写入资源失败 HTTP ${status}: ${String(text).slice(0, 200)}`
    if (status !== 409 && status !== 429) break
    await new Promise((r) => setTimeout(r, 6000))
  }
  bail(lastErr ?? '写入资源失败', { hit: false })
}

// ── 3. 轮询直到检索命中 ───────────────────────────────────────
// 写入到可检索是异步的（向量化 + VLM 摘要 + 建索引）。唯一靠得住的
// 完成信号就是"查得到"，其余字段（fs/ls 的 abstract）都可能是滞后的。
async function waitForRecall() {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < RECALL_BUDGET_MS) {
    last = await search()
    if (last.hit) return { ...last, ms: Date.now() - t0 }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return { ...(last ?? { hit: false, score: 0, uri: null, total: 0 }), ms: Date.now() - t0 }
}

// ── 5. 清理历轮旧夹具 ──────────────────────────────────────────
async function cleanupOld() {
  const { json } = await getJson(
    `${BASE}/api/v1/fs/ls?uri=${encodeURIComponent(DIR)}`,
    { timeout: 10000 }
  ).catch(() => ({ json: null }))
  for (const it of json?.result ?? []) {
    const uri = String(it?.uri ?? '')
    if (uri && uri !== TARGET && uri.includes('/lsh-probe-')) {
      await fetchWithTimeout(
        `${BASE}/api/v1/fs?uri=${encodeURIComponent(uri)}`,
        { method: 'DELETE', timeout: 10000 }
      ).catch(() => {})
    }
  }
}

// ── 4. 语义检索 ────────────────────────────────────────────────
async function search() {
  const { status, json, text } = await postJson(`${BASE}/api/v1/search/search`, {
    query: `${MARK} 花椒属拉丁学名`,
    target_uri: 'viking://resources',
    limit: 5,
  }, { timeout: 40000 })
  if (status !== 200) {
    return { hit: false, error: `检索返回 ${status}: ${String(text).slice(0, 160)}` }
  }
  const r = json?.result ?? {}
  const all = [...(r.resources ?? []), ...(r.memories ?? []), ...(r.skills ?? [])]
  // 命中判据：召回的必须是本轮这个 URI。
  // 踩过的两个坑：① 曾经写成 uri.includes(MARK) —— 标记词只出现在文件内容里，
  //   URI 里没有，永远匹配不上，链路通着却一直报失败；
  // ② 后来放宽成路径前缀匹配，又被上一轮的旧索引满足，154ms 就"通过"。
  //   所以只能认准本轮唯一 URI。
  const hit = all.find((x) => String(x?.uri ?? '') === TARGET) ?? null
  return {
    hit: Boolean(hit),
    score: hit ? Number(hit.score ?? 0) : 0,
    uri: hit?.uri ?? null,
    total: r.total ?? all.length,
  }
}

const tempFileId = await upload()
if (!tempFileId) bail('上传夹具失败：拿不到 temp_file_id', { hit: false })

await add(tempFileId)
const found = await waitForRecall()
const totalMs = Date.now() - started

// 清掉历轮留下的旧夹具，别让库里堆垃圾（best effort，失败不影响结论）
await cleanupOld()

out({
  ok: Boolean(found.hit),
  hit: Boolean(found.hit),
  score: found.score ?? 0,
  uri: found.uri ?? null,
  total: found.total ?? 0,
  // 写入到可检索的耗时。这个数字本身就是指标：本地 14B 做摘要是瓶颈，
  // 它一涨就说明 Ollama 那边出问题了（或被别的大模型把显存挤掉了）。
  recall_ms: found.ms ?? 0,
  total_ms: totalMs,
  needs_credentials: false,
  note: found.hit
    ? found.ms > 300000
      ? `链路通，但写入到可检索用了 ${(found.ms / 1000).toFixed(0)}s —— 偏慢。瓶颈是 VLM（一个资源触发 3 次调用），换小模型是唯一根治办法。`
      : null
    : found.error
      ? found.error
      : `写入成功但 ${(RECALL_BUDGET_MS / 1000).toFixed(0)}s 内检索不到 —— 向量化或索引这一环断了。/health 是绿的，但它回答不了「真的能用吗」。查 ~/.openviking/server.log 里的 semantic 相关日志，重点看有没有 APITimeoutError（VLM 超时）或 LockAcquisitionError（连着跑多轮会把写入路径堵住，等几分钟再来）。`,
})
