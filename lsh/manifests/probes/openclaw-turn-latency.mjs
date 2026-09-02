#!/usr/bin/env node
/**
 * L3 探针：OpenClaw agent turn 延迟
 *
 * 断言（manifest）：ms < 60000
 *
 * 为什么需要这个探针：
 *   本机实测过一次：同一个请求直连 provider 只要 6.1s，走网关要 280s
 *   （46 倍）。网关全程"健康"—— 端口在、/health 200、进程活着。
 *   延迟异常几乎总是路由问题（走错 provider / 被代理绕路），不是模型慢。
 *   这类退化只有真的发一个 turn 才能发现。
 *
 * 成本说明：
 *   这个探针会真实消耗 token，是全部探针里唯一"不免费"的。
 *   - 设 LSH_OPENCLAW_PROBE_MODEL 指向本地模型（如 ollama/qwen2.5-coder:14b）
 *     即可做到零成本、零外网依赖，推荐用于定时巡检。
 *   - 不设则走网关默认路由，可能打到云端付费 provider。
 *   - 想彻底关闭：LSH_OPENCLAW_PROBE_MODEL=skip
 *
 * 基线对比（可选）：
 *   设 LSH_BASELINE_URL + LSH_BASELINE_MODEL 后，探针会同时直连 provider
 *   跑同一个请求，输出 ratio。ratio 才是"网关拖慢了多少"的直接证据。
 */
import { out, bail, isListening, postJson, env, resolveBin, sh } from './_lib.mjs'

const PORT = Number(env('LSH_OPENCLAW_PORT', '18789'))
const BIN_NAME = env('LSH_OPENCLAW_BIN', 'openclaw')
const MODEL = env('LSH_OPENCLAW_PROBE_MODEL', '')
const TIMEOUT_S = Number(env('LSH_OPENCLAW_PROBE_TIMEOUT', '90'))
const BUDGET_MS = Number(env('LSH_TURN_BUDGET_MS', '60000'))

// "ping" 太短会让某些 provider 直接返回空，用一句需要真正生成的话
const PROMPT = env('LSH_TURN_PROMPT', 'Reply with exactly one word: ok')

if (MODEL.toLowerCase() === 'skip') {
  bail('probe_disabled', { hint: 'LSH_OPENCLAW_PROBE_MODEL=skip，跳过高成本 turn 探针' })
}

if (!(await isListening(PORT))) {
  bail('gateway_not_listening', { running: false, port: PORT })
}

const bin = await resolveBin(BIN_NAME)
if (!bin.bin) bail('cli_not_found', { running: true, error: bin.error })

const args = ['agent', '--json', '-m', PROMPT, '--timeout', String(TIMEOUT_S)]
if (MODEL) args.push('--model', MODEL)

const t0 = Date.now()
const r = await sh(bin.bin, args, { timeout: (TIMEOUT_S + 20) * 1000 })
const ms = Date.now() - t0

const result = {
  running: true,
  cli_version: bin.version,
  model: MODEL || '(gateway default)',
  prompt: PROMPT,
  ms,
  exit_code: r.code,
  timed_out: ms >= TIMEOUT_S * 1000,
  budget_ms: BUDGET_MS,
}

if (r.code !== 0 && !r.stdout) {
  result.ok = false
  result.error = `agent turn 失败（exit ${r.code}）: ${r.stderr.slice(0, 300)}`
  // 退出非 0 且明显很快返回 = 被网关拒绝（插件损坏的典型表现）
  if (ms < 5000) result.rejection_likely = true
  out(result)
}

let payload = null
try {
  payload = JSON.parse(r.stdout)
} catch {
  result.parse_error = `输出不是 JSON: ${r.stdout.slice(0, 200)}`
}

if (payload) {
  const reply =
    payload.reply ?? payload.text ?? payload.message ?? payload.result?.reply ?? null
  result.reply_chars = typeof reply === 'string' ? reply.length : 0
  result.reply_preview = typeof reply === 'string' ? reply.slice(0, 80) : null
  result.usage = payload.usage ?? payload.result?.usage ?? null
  result.error_field = payload.error ?? null
  // 网关返回了结构但没内容 —— 也是假活的一种
  if (!reply && !result.error_field) result.empty_reply = true
}

// ── 可选基线：直连 provider 跑同一请求 ───────────────────────────────
const baseUrl = env('LSH_BASELINE_URL')
const baseModel = env('LSH_BASELINE_MODEL')
if (baseUrl && baseModel) {
  const b0 = Date.now()
  const direct = await postJson(
    `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`,
    { model: baseModel, messages: [{ role: 'user', content: PROMPT }], max_tokens: 16 },
    { timeout: TIMEOUT_S * 1000 }
  )
  result.baseline = {
    url: baseUrl,
    model: baseModel,
    ms: Date.now() - b0,
    status: direct.status,
    ok: direct.status === 200,
  }
  if (result.baseline.ok && result.baseline.ms > 0) {
    result.ratio = Number((ms / result.baseline.ms).toFixed(1))
  }
}

result.ok = result.ms < BUDGET_MS && !result.timed_out && !result.error && !result.empty_reply
out(result)
