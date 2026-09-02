/**
 * L3 语义探针共享库。
 *
 * 契约（引擎依赖，勿改）：
 *   1. 结果以 JSON 写到 stdout 的最后一行
 *   2. exit 0 表示"探针跑完了"，不代表断言通过 —— 断言交给引擎做
 *   3. 环境不具备条件时（服务没起、缺凭据），必须显式报告
 *      needs_credentials / running:false，绝不能返回 0 假装通过
 *   4. 每个探针自己管超时，不能把引擎挂住
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** 输出结果并退出。这是探针唯一的正常出口。 */
export function out(obj) {
  console.log(JSON.stringify(obj))
  process.exit(0)
}

/** 探针无法执行（区别于"执行了但结果是坏的"） */
export function bail(reason, extra = {}) {
  console.log(JSON.stringify({ ok: false, skipped: true, reason, ...extra }))
  process.exit(0)
}

/** 带超时的 fetch */
export async function fetchWithTimeout(url, { timeout = 8000, ...init } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return { res, ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

export async function getJson(url, opts = {}) {
  const { res, ms } = await fetchWithTimeout(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 响应由调用方处理 */
  }
  return { status: res.status, json, text, ms }
}

export async function postJson(url, body, opts = {}) {
  return getJson(url, {
    ...opts,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
  })
}

/** 执行本机命令。返回 {code, stdout, stderr}，超时按失败处理。 */
export async function sh(cmd, args = [], { timeout = 15000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout, encoding: 'utf8' })
    return { code: 0, stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim() }
  } catch (e) {
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr ?? String(e.message)).trim(),
    }
  }
}

/** 端口是否有进程在监听（用 lsof -F pcn，与 Rust 侧保持一致） */
export async function isListening(port) {
  const { stdout } = await sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 8000 })
  return stdout.split('\n').filter(Boolean).length > 0
}

export function env(name, fallback = null) {
  return process.env[name] ?? fallback
}

/**
 * 定位 CLI 二进制。
 *
 * 坑：Tauri GUI 应用和 launchd job 的 PATH 都是 /usr/bin:/bin:/usr/sbin:/sbin，
 * 不含 /opt/homebrew/bin 也不含 ~/.local/bin —— 直接用 `sh('openclaw', ...)`
 * 会拿到 ENOENT。必须显式列出候选路径。
 */
const BIN_CANDIDATES = {
  openclaw: [
    '/Users/jindy/.local/bin/openclaw',
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
  ],
}

export async function resolveBin(name) {
  const direct = await sh(name, ['--version'], { timeout: 10000 })
  if (direct.code === 0) return { bin: name, version: firstLine(direct.stdout) }

  for (const p of BIN_CANDIDATES[name] ?? []) {
    const r = await sh(p, ['--version'], { timeout: 10000 })
    if (r.code === 0) return { bin: p, version: firstLine(r.stdout) }
  }
  return { bin: null, version: null, error: `找不到 ${name}（也不在候选路径中）` }
}

function firstLine(s) {
  return String(s ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''
}

/** 执行 CLI 并解析 JSON 输出。CLI 常把警告打到 stderr，stdout 保持纯净。 */
export async function cliJson(bin, args, { timeout = 60000 } = {}) {
  const r = await sh(bin, args, { timeout })
  if (r.code !== 0 && !r.stdout) {
    return { error: `exit ${r.code}: ${r.stderr.slice(0, 200)}`, code: r.code, stderr: r.stderr }
  }
  try {
    return { json: JSON.parse(r.stdout), code: r.code, stderr: r.stderr }
  } catch {
    return { error: `输出不是 JSON: ${r.stdout.slice(0, 200)}`, code: r.code, stderr: r.stderr }
  }
}

/**
 * 本地化垃圾结果判定。
 * SearXNG 的 bing 引擎在 default_lang 不对时按出口 IP 猜地区，
 * 返回词典站、房产站、本地生活站这类跟查询词无关的东西。
 */
const LOCALIZED_TLDS = ['.kr', '.jp', '.cn', '.tw', '.vn', '.th', '.ru']
const LOCALIZED_HINTS = [
  '词典', '字典', '辞典', '翻译', '什么意思', '怎么读',
  '부동산', '物件', '不動産', '地产', '房产', '租房',
  'baidu', 'naver', 'dancihu', 'iciba', 'youdao', 'goo.ne',
]

export function isLocalizedResult(url = '', title = '') {
  const hay = `${url} ${title}`.toLowerCase()
  if (LOCALIZED_TLDS.some((tld) => url.toLowerCase().includes(tld))) return true
  return LOCALIZED_HINTS.some((h) => hay.includes(h))
}

/* ─────────────────────────  Odysseus 认证  ─────────────────────────
 *
 * 实测约束（2026-09-02 本机验证）：
 *   1. AUTH_ENABLED=true 且 LOCALHOST_BYPASS=false —— 除 /api/health、
 *      /api/version、/api/auth/* 外，所有 /api/* 都要认证。
 *   2. `Bearer ody_...` API Token 能用，但：
 *      - 必须有 `chat` scope 且必须绑定 owner
 *      - current_user 被置为 "api"，**不是 admin**
 *      - /api/embeddings/* 与 /api/model-endpoints 挂了
 *        dependencies=[Depends(require_admin)] → token 调用一律 403
 *      所以 token 只能覆盖部分探针，不能当主路径。
 *   3. 主路径是 cookie session（管理员账号密码登录）。登录接口有
 *      _login_limiter 限流，5 分钟一次的探针不能每次都登录 —— 必须缓存。
 *   4. 进程内 X-Odysseus-Internal-Token 每次启动随机，外部无法使用。
 *
 * 凭据来源（按优先级）：
 *   LSH_ODYSSEUS_TOKEN   —— ody_ 开头，免登录，但权限受限
 *   LSH_ODYSSEUS_USER + LSH_ODYSSEUS_PASS —— 登录拿 cookie，全权限
 */

const SESSION_CACHE = join(homedir(), '.lsh', 'state', 'odysseus.session.json')

/** 从 set-cookie 头里抠出 session cookie 值 */
function pickSessionCookie(setCookie) {
  if (!setCookie) return null
  // set-cookie 可能含多个 cookie，取第一个 k=v 段即可
  const first = String(setCookie).split(',')[0]
  const m = first.match(/^([^=]+)=([^;]*)/)
  if (!m) return null
  return { name: m[1], value: m[2] }
}

async function readSessionCache() {
  try {
    const raw = await readFile(SESSION_CACHE, 'utf8')
    const j = JSON.parse(raw)
    if (j?.name && j?.value) return j
  } catch {
    /* 没缓存或缓存坏了 —— 重新登录即可 */
  }
  return null
}

async function writeSessionCache(cookie) {
  try {
    await mkdir(join(homedir(), '.lsh', 'state'), { recursive: true })
    await writeFile(SESSION_CACHE, JSON.stringify({ ...cookie, saved_at: Date.now() }), {
      mode: 0o600,
    })
  } catch {
    /* 缓存写不进去不影响本次探针 */
  }
}

/** 校验一个 cookie 是否还有效（/api/auth/status 是免认证的） */
async function sessionAlive(base, cookie) {
  const { json, status } = await getJson(`${base}/api/auth/status`, {
    timeout: 8000,
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  })
  if (status !== 200) return false
  return Boolean(json?.authenticated ?? json?.username ?? json?.user)
}

/**
 * 拿 Odysseus 的认证态。
 *
 * @returns {Promise<{headers:Object, mode:'token'|'session'}|null>}
 *   null 表示"没有任何凭据"，调用方应报 needs_credentials。
 *   失败时返回 {error: string}。
 */
export async function odysseusAuth(base) {
  // 1) API token 优先：无状态、不限流
  const rawToken = env('LSH_ODYSSEUS_TOKEN')
  if (rawToken) {
    return { headers: { accept: 'application/json', Authorization: `Bearer ${rawToken}` }, mode: 'token' }
  }

  // 2) 复用缓存 session
  const cached = await readSessionCache()
  if (cached && (await sessionAlive(base, cached))) {
    return { headers: { accept: 'application/json', cookie: `${cached.name}=${cached.value}` }, mode: 'session' }
  }

  // 3) 登录
  const user = env('LSH_ODYSSEUS_USER')
  const pass = env('LSH_ODYSSEUS_PASS')
  if (!user || !pass) return null

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: ctrl.signal,
    })
    const text = await res.text()

    if (res.status === 429) return { error: '登录被限流（429），稍后重试' }
    if (!res.ok) return { error: `登录失败 HTTP ${res.status}: ${text.slice(0, 160)}` }

    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应，只看 cookie */
    }
    if (json && json.ok === false) {
      if (json.requires_totp) return { error: '账号启用了 2FA，探针无法无人值守登录' }
      return { error: `登录被拒: ${JSON.stringify(json).slice(0, 160)}` }
    }

    const cookie = pickSessionCookie(res.headers.get('set-cookie'))
    if (!cookie) return { error: `登录成功但拿不到 session cookie: ${text.slice(0, 160)}` }

    await writeSessionCache(cookie)
    return { headers: { accept: 'application/json', cookie: `${cookie.name}=${cookie.value}` }, mode: 'session' }
  } catch (e) {
    return { error: String(e.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}
