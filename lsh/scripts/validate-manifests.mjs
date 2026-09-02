#!/usr/bin/env node
/**
 * 校验 manifests/services/*.yaml：
 *   1. YAML 可解析
 *   2. 符合 manifests/schema/service-manifest.schema.json
 *   3. id 唯一
 *   4. depends_on 引用的服务存在
 *   5. 依赖图无环（有环则无法做启停拓扑排序）
 *   6. playbooks 引用的剧本文件存在
 *   7. detect.ports 不与其他服务重复
 *
 *   node scripts/validate-manifests.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import Ajv2020 from 'ajv/dist/2020.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICES_DIR = join(ROOT, 'manifests', 'services')
const PLAYBOOKS_DIR = join(ROOT, 'manifests', 'playbooks')
const SCHEMA_PATH = join(ROOT, 'manifests', 'schema', 'service-manifest.schema.json')
const PB_SCHEMA_PATH = join(ROOT, 'manifests', 'schema', 'playbook.schema.json')

const errors = []
const warnings = []

function fail(file, msg) {
  errors.push(`${file}: ${msg}`)
}
function warn(file, msg) {
  warnings.push(`${file}: ${msg}`)
}

// ---------- 1 + 2: 解析与 schema 校验 ----------
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

const files = readdirSync(SERVICES_DIR)
  .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  .sort()

if (files.length === 0) {
  console.error('没有找到任何 manifest 文件')
  process.exit(1)
}

const manifests = []

for (const file of files) {
  let doc
  try {
    doc = load(readFileSync(join(SERVICES_DIR, file), 'utf8'))
  } catch (e) {
    fail(file, `YAML 解析失败 — ${e.message}`)
    continue
  }

  if (!validate(doc)) {
    for (const err of validate.errors) {
      const where = err.instancePath || '(root)'
      fail(file, `${where} ${err.message}`)
    }
    continue
  }

  manifests.push({ file, doc })
}

// ---------- 3: id 唯一 ----------
const byId = new Map()
for (const { file, doc } of manifests) {
  if (byId.has(doc.id)) {
    fail(file, `id "${doc.id}" 与 ${byId.get(doc.id).file} 重复`)
  }
  byId.set(doc.id, { file, doc })
}

// ---------- 4: depends_on 存在 ----------
for (const { file, doc } of manifests) {
  for (const dep of doc.depends_on ?? []) {
    if (!byId.has(dep) && !manifests.some((m) => m.doc.id === dep)) {
      fail(file, `depends_on 引用了不存在的服务 "${dep}"`)
    }
  }
}

// ---------- 5: 依赖图无环 ----------
const graph = new Map(manifests.map(({ doc }) => [doc.id, doc.depends_on ?? []]))
const state = new Map() // 0=未访问 1=访问中 2=已完成
const cycles = []

function visit(id, path) {
  if (state.get(id) === 1) {
    cycles.push([...path.slice(path.indexOf(id)), id].join(' → '))
    return
  }
  if (state.get(id) === 2) return
  state.set(id, 1)
  for (const dep of graph.get(id) ?? []) {
    if (graph.has(dep)) visit(dep, [...path, id])
  }
  state.set(id, 2)
}
for (const id of graph.keys()) visit(id, [])

if (cycles.length > 0) {
  for (const c of cycles) fail('dependency-graph', `检测到循环依赖：${c}`)
}

// ---------- 6: playbook 文件存在 ----------
for (const { file, doc } of manifests) {
  for (const pb of doc.playbooks ?? []) {
    const p = join(PLAYBOOKS_DIR, `${pb}.yaml`)
    if (!existsSync(p)) {
      warn(file, `引用了尚未落地的 playbook "${pb}"（${p} 不存在）`)
    }
  }
}

// ---------- 7: 端口唯一 ----------
const portOwner = new Map()
for (const { file, doc } of manifests) {
  for (const port of doc.detect?.ports ?? []) {
    if (portOwner.has(port)) {
      fail(file, `端口 ${port} 与 ${portOwner.get(port)} 冲突`)
    }
    portOwner.set(port, doc.id)
  }
}

// ---------- 8: playbook 自身校验 ----------
const pbSchema = JSON.parse(readFileSync(PB_SCHEMA_PATH, 'utf8'))
const pbValidate = ajv.compile(pbSchema)

const pbFiles = existsSync(PLAYBOOKS_DIR)
  ? readdirSync(PLAYBOOKS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort()
  : []

const playbooks = []
for (const file of pbFiles) {
  let doc
  try {
    doc = load(readFileSync(join(PLAYBOOKS_DIR, file), 'utf8'))
  } catch (e) {
    fail(file, `YAML 解析失败 — ${e.message}`)
    continue
  }
  if (!pbValidate(doc)) {
    for (const err of pbValidate.errors) {
      fail(file, `${err.instancePath || '(root)'} ${err.message}`)
    }
    continue
  }
  playbooks.push({ file, doc })

  // 剧本题到的 service 必须存在
  if (doc.service && !byId.has(doc.service)) {
    fail(file, `service "${doc.service}" 不是已知服务 id`)
  }
  // manual 模式不应带 sudo 之外的自动步骤（防止误配）
  if (doc.requires_sudo && doc.fix?.mode === 'auto') {
    fail(file, 'requires_sudo 的剧本不允许 mode: auto')
  }
  // 有 fix 步骤就应该有 verify
  if ((doc.fix?.steps ?? []).length > 0 && !doc.verify) {
    warn(file, '有修复步骤但没有 verify，无法确认修完是否真的好了')
  }
}

const pbIds = new Set(playbooks.map((p) => p.doc.id))
for (const p of playbooks) {
  if (pbIds.has(p.doc.id) && playbooks.filter((x) => x.doc.id === p.doc.id).length > 1) {
    fail(p.file, `playbook id "${p.doc.id}" 重复`)
  }
}

// ---------- 报告 ----------
const totalL3 = manifests.reduce((n, m) => n + (m.doc.health?.l3 ?? []).length, 0)
const totalLogs = manifests.reduce((n, m) => n + (m.doc.logs ?? []).length, 0)
const kindCount = {}
for (const { doc } of manifests) {
  kindCount[doc.supervisor.kind] = (kindCount[doc.supervisor.kind] ?? 0) + 1
}

console.log(`\n已校验 ${manifests.length} 个服务 manifest`)
console.log(`  托管方式：${Object.entries(kindCount).map(([k, v]) => `${k}×${v}`).join('  ')}`)
console.log(`  L3 语义探针：${totalL3} 个 · 日志源：${totalLogs} 个`)
console.log(`  依赖边数：${[...graph.values()].reduce((n, d) => n + d.length, 0)}`)
console.log(`已校验 ${playbooks.length} 个 playbook`)
const byMode = {}
for (const { doc } of playbooks) {
  const m = doc.fix?.mode ?? 'manual(无 fix)'
  byMode[m] = (byMode[m] ?? 0) + 1
}
console.log(`  修复档位：${Object.entries(byMode).map(([k, v]) => `${k}×${v}`).join('  ')}`)

for (const w of warnings) console.log(`  ⚠ ${w}`)

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} 个错误：`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}

console.log(`\n✓ 全部通过（${warnings.length} 个警告）`)
