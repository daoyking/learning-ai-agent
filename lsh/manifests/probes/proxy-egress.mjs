#!/usr/bin/env node
/**
 * L3 探针：代理到底能不能出网
 *
 * 为什么需要它：
 *   ClashX 图标在、端口在、控制 API /version 返回 200，但订阅过期或规则失效时
 *   出网照样失败。此时所有"供应商挂了"的判断都是错的 —— 根因在这里。
 *
 * ── 本探针踩过的坑，必须守住 ──────────────────────────────────────
 * 初版拿 api.openai.com 走代理、www.baidu.com 直连，代理挂了 0 分而直连 200，
 * 于是判 proxy_broken。这是**误报**：两个根本不同的域名没有可比性。
 * 实测（2026-09-02）：
 *     example.com    direct=200  proxy=200
 *     api.github.com direct=200  proxy=200
 *     cloudflare     direct=200  proxy=200
 *     api.openai.com direct=000  proxy=000   ← 网络层封锁，两条路都不通
 * 代理其实是好的，openai 是访问不了。拿它当 canary 会把整个诊断带偏。
 *
 * 所以规则固定为：**同一组 canary 分别走"经代理"和"直连"逐条对比**，
 * 并且显式列出"两条路都不通"的域名，避免用户去折腾一个没坏的代理。
 *
 * 输出：{ ok, verdict, per_target, proxy_ok, direct_ok, blocked_everywhere }
 * 断言：ok == true
 */
import { out, bail, isListening, sh, env } from './_lib.mjs'

const PROXY_PORT = Number(env('LSH_PROXY_PORT', 7890))
const PROXY = env('LSH_PROXY_URL', `http://127.0.0.1:${PROXY_PORT}`)
const TIMEOUT = Number(env('LSH_EGRESS_TIMEOUT', 8))

/**
 * Canary 选点原则：全球可达、无鉴权、不挑地区、不会被规则引擎特殊对待。
 * 严禁放入 api.openai.com / api.anthropic.com 这类会被网络层或代理规则
 * 按域名处理的地址 —— 它们的失败说明不了代理好坏。
 */
const DEFAULT_CANARIES = [
  'https://example.com',
  'https://api.github.com',
  'https://www.cloudflare.com/cdn-cgi/trace',
  'https://www.baidu.com',
]
const canaries = (env('LSH_EGRESS_CANARIES', '') || DEFAULT_CANARIES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const proxyAlive = await isListening(PROXY_PORT)
if (!proxyAlive) {
  bail(`代理端口 ${PROXY_PORT} 没有进程监听`, {
    ok: false,
    proxy_alive: false,
    verdict: 'proxy_down',
  })
}

const code = async (extraArgs) => {
  const r = await sh('curl', [...extraArgs], { timeout: (TIMEOUT + 4) * 1000 })
  // curl 用 -w '%{http_code}' 输出；000 = 没拿到任何响应
  const n = Number((r.stdout || '0').trim().split('\n').pop())
  return Number.isFinite(n) ? n : 0
}

const started = Date.now()

// 同一域名跑两条路，全部并发，避免串行把探针拖到几十秒
const perTarget = await Promise.all(
  canaries.map(async (target) => {
    const [viaProxy, direct] = await Promise.all([
      code(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', String(TIMEOUT), '-x', PROXY, target]),
      code(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', String(TIMEOUT), '--noproxy', '*', target]),
    ])
    return { target, via_proxy: viaProxy, direct }
  })
)

/** 2xx/3xx 算通；4xx 说明链路是通的（被对方拒绝也算到达）；5xx/0 算不通 */
const reachable = (c) => c > 0 && c < 500

const proxyOkList = perTarget.filter((t) => reachable(t.via_proxy))
const directOkList = perTarget.filter((t) => reachable(t.direct))
// 两条路都不通 → 网络层/防火墙级封锁，跟代理无关，绝不能算到代理头上
const blockedEverywhere = perTarget.filter((t) => !reachable(t.via_proxy) && !reachable(t.direct))

let verdict
let hint
if (proxyOkList.length > 0) {
  verdict = 'ok'
  if (blockedEverywhere.length > 0) {
    hint = `代理正常；${blockedEverywhere.map((t) => new URL(t.target).host).join('、')} 两条路都不通，属网络层封锁，不是代理问题`
  }
} else if (directOkList.length > 0) {
  verdict = 'proxy_broken'
  hint = '直连通、代理不通 → 问题在 ClashX 本身（订阅过期/规则失效/节点全挂）。见 playbook proxy-dead'
} else {
  verdict = 'network_down'
  hint = '直连也不通 → 物理网络问题，去查 Wi-Fi 和运营商，别动代理配置'
}

out({
  ok: verdict === 'ok',
  verdict,
  proxy_alive: proxyAlive,
  proxy_url: PROXY,
  proxy_ok: proxyOkList.length,
  direct_ok: directOkList.length,
  canaries: perTarget.length,
  per_target: perTarget,
  blocked_everywhere: blockedEverywhere.map((t) => t.target),
  hint,
  ms: Date.now() - started,
})
