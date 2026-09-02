#!/usr/bin/env node
/**
 * L3 探针：OpenClaw 插件完整性
 *
 * 断言（manifest）：healthy == true
 *
 * 为什么需要这个探针：
 *   插件校验失败时，网关进程照常监听 18789、/health 照常返回 200，
 *   但任何 agent turn 都会被拒 —— 端口在、心跳在、能力不在。
 *   这是本项目要抓的头号假活形态。
 *
 * 三层检查：
 *   1. plugins doctor —— 模块加载 / 兼容性 / 配置告警（离线可用）
 *   2. plugins list   —— 插件注册表能否构建（registry.diagnostics）
 *   3. doctor --lint  —— 全量只读体检，看 plugin 相关 finding
 *
 * 网关没起时依然跑 1、2 两层并如实标注 running:false：
 *   插件损坏本身就可能是不启动的原因，这个信息对排障有用。
 */
import { out, bail, isListening, env, resolveBin, cliJson, sh } from './_lib.mjs'

const PORT = Number(env('LSH_OPENCLAW_PORT', '18789'))
const BIN_NAME = env('LSH_OPENCLAW_BIN', 'openclaw')

const running = await isListening(PORT)

const bin = await resolveBin(BIN_NAME)
if (!bin.bin) {
  bail('cli_not_found', { running, error: bin.error })
}

const t0 = Date.now()

// ── 第 1 层：插件加载健康（不需要网关在跑）──────────────────────────
const doctor = await cliJson(bin.bin, ['plugins', 'doctor', '--json'], { timeout: 60000 })

// ── 第 2 层：注册表构建 ────────────────────────────────────────────────
const list = await cliJson(bin.bin, ['plugins', 'list', '--json'], { timeout: 60000 })

const plugins = Array.isArray(list.json?.plugins) ? list.json.plugins : []
const enabled = plugins.filter((p) => p.enabled).length
const broken = plugins.filter((p) => p.status && p.status !== 'loaded' && p.status !== 'disabled')

const result = {
  running,
  cli_version: bin.version,
  plugin_total: plugins.length,
  plugin_enabled: enabled,
  plugin_broken: broken.length,
  plugin_broken_ids: broken.map((p) => ({ id: p.id, status: p.status })),
  plugin_errors: Array.isArray(doctor.json?.pluginErrors) ? doctor.json.pluginErrors : [],
  diagnostics: Array.isArray(doctor.json?.diagnostics) ? doctor.json.diagnostics : [],
  compatibility: Array.isArray(doctor.json?.compatibility) ? doctor.json.compatibility : [],
  configuration_warnings: Array.isArray(doctor.json?.configurationWarnings)
    ? doctor.json.configurationWarnings
    : [],
  source_shadowing: Array.isArray(doctor.json?.sourceShadowing) ? doctor.json.sourceShadowing : [],
  registry_diagnostics: Array.isArray(list.json?.registry?.diagnostics)
    ? list.json.registry.diagnostics
    : [],
}

if (doctor.error) result.plugin_error = `plugins doctor: ${doctor.error}`
if (list.error) result.list_error = `plugins list: ${list.error}`

// ── 第 3 层：全量体检（只在网关活着时才有意义）──────────────────────
if (running) {
  const full = await cliJson(bin.bin, ['doctor', '--json', '--lint'], { timeout: 90000 })
  if (full.json) {
    const findings = Array.isArray(full.json.findings) ? full.json.findings : []
    result.doctor_ok = full.json.ok
    result.checks_run = full.json.checksRun
    result.checks_skipped = full.json.checksSkipped
    result.plugin_findings = findings.filter((f) => String(f.checkId ?? '').includes('plugin'))
    result.error_findings = findings.filter((f) => f.severity === 'error')
  } else {
    result.doctor_error = full.error
  }

  // 网关活着时再确认一次 HTTP 层：/health 200 不等于能接 turn
  const health = await sh('curl', ['-s', '--max-time', '5', '-o', '/dev/null', '-w', '%{http_code}',
    `http://127.0.0.1:${PORT}/health`], { timeout: 8000 })
  result.http_health = health.stdout
}

const pluginClean =
  result.plugin_errors.length === 0 &&
  result.compatibility.length === 0 &&
  result.plugin_broken === 0 &&
  result.registry_diagnostics.length === 0

result.healthy = running && pluginClean && (result.error_findings ?? []).length === 0
result.ok = result.healthy
result.ms = Date.now() - t0

if (!running) {
  result.reason = 'gateway_not_listening'
  result.hint =
    pluginClean
      ? '插件层干净，网关未监听 —— 多半是服务没起或被 launchd 回收，看 gateway-restart.log'
      : '插件层有异常，很可能就是网关起不来的原因'
}

out(result)
