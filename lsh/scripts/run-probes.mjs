#!/usr/bin/env node
/**
 * L3 探针运行器。
 *
 * 用途：
 *   1. 开发期一次性跑完所有探针，肉眼核对输出是否符合预期
 *   2. 作为引擎侧 ProbeRunner 的行为参考（超时、退出码、缺凭据的处理）
 *
 * 用法：
 *   node scripts/run-probes.mjs                 # 跑全部
 *   node scripts/run-probes.mjs searxng ollama  # 只跑 id 含关键字的
 *   node scripts/run-probes.mjs --json          # 输出机器可读汇总
 *
 * 契约：探针 exit 0 表示"跑完了"，不等于断言通过。断言由引擎按 manifest
 * 的 assert 表达式求值，本运行器只做展示，不代替引擎判定。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import yaml from 'js-yaml'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICES = join(ROOT, 'manifests', 'services')
const PROBES = join(ROOT, 'manifests', 'probes')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const filters = args.filter((a) => !a.startsWith('--'))

const files = (await readdirServices()).sort()
const jobs = []

for (const f of files) {
  const doc = yaml.load(await readFile(join(SERVICES, f), 'utf8'))
  const l3 = doc?.health?.l3 ?? []
  for (const probe of l3) {
    if (!probe.script) continue
    const key = `${doc.id}/${probe.id}`
    if (filters.length && !filters.some((k) => key.includes(k))) continue
    jobs.push({ service: doc.id, probe: probe.id, script: probe.script, assert: probe.assert })
  }
}

async function readdirServices() {
  const { readdir } = await import('node:fs/promises')
  return (await readdir(SERVICES)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
}

const NODE = process.execPath
const results = []

for (const job of jobs) {
  const started = Date.now()
  let res
  try {
    const { stdout } = await execFileAsync(
      NODE,
      [join(PROBES, job.script.replace(/^probes\//, ''))],
      { timeout: 150000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    )
    const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
    let json = null
    try {
      json = JSON.parse(lastLine)
    } catch {
      json = { _parse_error: `末行不是 JSON: ${lastLine.slice(0, 200)}` }
    }
    res = json
  } catch (e) {
    res = { _crash: String(e.message ?? e).slice(0, 300) }
  }
  results.push({ ...job, wall_ms: Date.now() - started, result: res })
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(0)
}

const C = { green: '\x1b[32m', amber: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m', off: '\x1b[0m' }
const c = (s, col) => `${C[col]}${s}${C.off}`

let pass = 0
let fail = 0
let skip = 0

for (const r of results) {
  const res = r.result ?? {}
  let tag
  let color
  if (res._crash) {
    tag = 'CRASH'
    color = 'red'
    fail++
  } else if (res._parse_error) {
    tag = 'BADOUT'
    color = 'red'
    fail++
  } else if (res.skipped || res.needs_credentials) {
    // 缺凭据不是"检查没过"，是"没法检查" —— 必须和 FAIL 区分开，
    // 否则用户会以为服务坏了，实际只是没给钥匙。
    tag = 'SKIP'
    color = 'gray'
    skip++
  } else if (res.ok === true) {
    tag = 'PASS'
    color = 'green'
    pass++
  } else {
    tag = 'FAIL'
    color = 'red'
    fail++
  }

  // running:false 的 PASS 是有条件的通过（例如"日志里没冲突"但服务压根没起），
  // 必须显式标出来，不然看着一片绿实则全是空转。
  const runningTag =
    res.running === false ? c(' [服务未运行]', 'amber') : res.running === true ? '' : ''

  console.log(
    `${c(tag.padEnd(6), color)} ${r.service}/${r.probe}  ${c(`${r.wall_ms}ms`, 'gray')}${runningTag}`
  )
  console.log(`${' '.repeat(8)}assert: ${r.assert ?? '(none)'}`)

  const brief = { ...res }
  delete brief.ok
  delete brief.ms
  const line = JSON.stringify(brief)
  console.log(`${' '.repeat(8)}${line.length > 400 ? `${line.slice(0, 400)}…` : line}`)
  console.log()
}

console.log(
  `${c('PASS', 'green')} ${pass}   ${c('FAIL', 'red')} ${fail}   ${c('SKIP', 'gray')} ${skip}   total ${results.length}`
)
