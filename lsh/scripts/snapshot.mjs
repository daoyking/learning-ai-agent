#!/usr/bin/env node
/**
 * 从真实本机扫描生成 public/snapshot.json。
 *
 * 用途：浏览器（vite dev / 预览）里没有 Tauri runtime，
 * 前端会 fallback 读这份快照 —— 所以预览界面里看到的仍然是
 * 本机真实的服务状态，而不是假数据。
 *
 * 扫描逻辑与 src-tauri/src/scanner.rs 保持一致（同走 lsof -F pcn）。
 *
 *   node scripts/snapshot.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICES_DIR = join(ROOT, 'manifests', 'services')
const OUT_DIR = join(ROOT, 'public')

function scanListeningPorts() {
  let stdout
  try {
    stdout = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {
    // lsof 在无匹配时退出码为 1，但 stdout 仍有内容
    stdout = e.stdout ?? ''
  }
  return parseLsof(stdout)
}

function parseLsof(raw) {
  const entries = []
  const seen = new Set()
  let pid = null
  let command = null

  for (const line of raw.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      pid = Number(value)
      command = null
    } else if (tag === 'c') {
      command = value
    } else if (tag === 'n') {
      const port = parsePort(value)
      if (port != null && pid != null) {
        const key = `${port}:${pid}`
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({
            port,
            pid,
            command: command ?? 'unknown',
            address: value,
            loopback_only: value.startsWith('127.0.0.1') || value.startsWith('[::1]'),
          })
        }
      }
    }
  }
  return entries.sort((a, b) => a.port - b.port)
}

function parsePort(addr) {
  const clean = addr.replace(/ \(LISTEN\)$/, '')
  const i = clean.lastIndexOf(':')
  if (i === -1) return null
  const p = Number(clean.slice(i + 1))
  return Number.isFinite(p) ? p : null
}

function expandHome(p) {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

function loadManifests() {
  const files = readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
  return files.map((f) => load(readFileSync(join(SERVICES_DIR, f), 'utf8')))
}

/**
 * 监管状态判定。与 src-tauri/src/scanner.rs 的语义保持一致：
 *   supervised     —— 在监管之下，崩溃会自动拉起
 *   unsupervised   —— 进程可能在跑，但没人盯着（launchd job 未加载 / 容器无重启策略）
 *   not_applicable —— 本就无监管体系（纯 GUI 应用、手工脚本）
 *   unknown        —— 判定失败。绝不当成"正常"。
 *
 * launchctl list <label>：已加载 exit 0，未加载 exit 113。
 */
function checkSupervision(supervisor) {
  const sup = supervisor?.supervision ?? {}
  const check = sup.check ?? 'none'

  if (check === 'launchd_job') {
    const label = supervisor?.label
    if (!label) return 'unknown'
    try {
      execFileSync('launchctl', ['list', label], { stdio: ['ignore', 'ignore', 'ignore'] })
      return 'supervised'
    } catch (e) {
      return e.status === 113 ? 'unsupervised' : 'unknown'
    }
  }

  if (check === 'docker_restart_policy') {
    const container = supervisor?.container
    if (!container) return 'unknown'
    try {
      const policy = execFileSync(
        'docker',
        ['inspect', '-f', '{{.HostConfig.RestartPolicy.Name}}', container],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim()
      if (!policy || policy === 'no' || policy === '<no value>') return 'unsupervised'
      if (sup.expect && policy !== sup.expect) return 'unsupervised'
      return 'supervised'
    } catch {
      // 容器不存在（还没创建）不等于没监管策略
      return 'unknown'
    }
  }

  // 明确靠手工脚本拉起、没有自动重启 —— 恒判未监管
  if (check === 'manual') return 'unsupervised'

  return 'not_applicable'
}

function pathExists(p) {
  try {
    readFileSync(p)
    return true
  } catch {
    try {
      return readdirSync(expandHome(p)).length >= 0
    } catch {
      return false
    }
  }
}

function buildCard(m, ports) {
  const declared = m.detect?.ports?.[0] ?? null
  let listeningPort = null
  let pid = null
  let process = null
  let portConflict = null

  for (const candidate of m.detect?.ports ?? []) {
    const hit = ports.find((p) => p.port === candidate)
    if (hit) {
      listeningPort = hit.port
      pid = hit.pid
      process = hit.command
      break
    }
  }

  if (listeningPort == null && declared != null) {
    const owner = ports.find((p) => p.port === declared)
    if (owner) {
      portConflict = { port: owner.port, command: owner.command, pid: owner.pid }
    }
  }

  const hasTrace =
    (m.detect?.launchd ?? []).length > 0 ||
    (m.detect?.paths ?? []).some(pathExists)

  const status = listeningPort != null ? 'running' : hasTrace ? 'stopped' : 'unknown'

  return {
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    category: m.category,
    priority: m.priority ?? 'P1',
    tags: m.tags ?? [],
    supervisor_kind: m.supervisor.kind,
    depends_on: m.depends_on ?? [],
    provides: m.provides ?? [],
    port: declared,
    listening_port: listeningPort,
    pid,
    process,
    status,
    supervised: checkSupervision(m.supervisor),
    probe_ms: 0,
    port_conflict: portConflict,
    playbooks: m.playbooks ?? [],
    l3_count: (m.health?.l3 ?? []).length,
    log_count: (m.logs ?? []).length,
  }
}

const ports = scanListeningPorts()
const manifests = loadManifests()
const services = manifests.map((m) => buildCard(m, ports))

const snapshot = {
  services,
  ports,
  scanned_at_ms: Date.now(),
  elapsed_ms: 0,
  manifest_dirs: [SERVICES_DIR],
  source: 'snapshot',
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'snapshot.json'), JSON.stringify(snapshot, null, 2))

const running = services.filter((s) => s.status === 'running').length
// 运行中但无人监管 = 现在能用，崩了没人拉起。这是最容易被忽略的风险，必须单列。
const orphan = services.filter((s) => s.status === 'running' && s.supervised === 'unsupervised')

console.log(`✓ 已生成 public/snapshot.json`)
console.log(`  监听端口 ${ports.length} 个 · 纳管服务 ${services.length} 个 · 在线 ${running} 个`)
for (const s of services) {
  const mark = s.status === 'running' ? '●' : s.status === 'stopped' ? '○' : '·'
  const sup =
    s.supervised === 'supervised'
      ? '托管'
      : s.supervised === 'unsupervised'
        ? '未托管'
        : s.supervised === 'not_applicable'
          ? '—'
          : '?'
  console.log(
    `  ${mark} ${s.name.padEnd(22)} :${String(s.port ?? '-').padEnd(6)} ${s.status.padEnd(8)} ${sup}`
  )
}
if (orphan.length > 0) {
  console.log(
    `\n  ⚠ ${orphan.length} 个服务在运行但无人监管：${orphan.map((s) => s.name).join('、')}`
  )
  console.log(`    崩溃后不会自动拉起，重启后需要手动恢复。`)
}
