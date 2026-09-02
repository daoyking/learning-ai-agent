#!/usr/bin/env node
/**
 * L3: dsh 插件 loader entry 是否冲突。
 *
 * 为什么需要它：出现 "duplicate loader entry id" 时，dsh 进程活着、
 * 端口也在，但冲突的那个插件功能直接残缺 —— 又一种假活。
 *
 * 判据：扫 pty 日志与 stderr 日志里的 duplicate loader entry 记录，
 *       提取冲突的 entry id 与来源 bundle。
 *
 * 输出：{ conflicts, entries[], running }
 * 断言：conflicts == 0
 */
import { out, sh, isListening, env } from './_lib.mjs'

const PORT = Number(env('LSH_DSH_PORT', 3080))
// 实测日志命名是 /tmp/dsh-web-run*.log、/tmp/dsh-web-restart.log，
// 而 launchd plist 里写的是 /tmp/dsh-web-pty.log —— 用通配覆盖全部
const LOG_GLOB = env('LSH_DSH_LOGS', '/tmp/dsh-web-*.log')

const running = await isListening(PORT)

// 日志不存在也算"没冲突"，但要如实说明是查不到日志而不是确认无冲突
const { stdout } = await sh('sh', ['-c', `grep -h "duplicate loader entry" ${LOG_GLOB} 2>/dev/null | sort -u | head -20`], {
  timeout: 15000,
})

const lines = stdout.split('\n').filter(Boolean)

// 形如：duplicate loader entry id "xxx" from bundle "yyy"（不同版本措辞略有差异）
const entries = []
for (const line of lines) {
  const idMatch = line.match(/entry\s+id\s+["']?([^"'\s,]+)["']?/i)
  const bundleMatch = line.match(/bundle\s+["']?([^"'\s,]+)["']?/i)
  entries.push({
    entry: idMatch?.[1] ?? null,
    bundle: bundleMatch?.[1] ?? null,
    raw: line.slice(0, 200),
  })
}

const logExists = await sh('sh', ['-c', `ls ${LOG_GLOB} 2>/dev/null | wc -l`], { timeout: 8000 })
const logCount = Number((logExists.stdout || '0').trim()) || 0

out({
  ok: entries.length === 0,
  conflicts: entries.length,
  entries,
  running,
  logs_found: logCount,
  note:
    logCount === 0
      ? '没找到 dsh 日志（服务可能未运行），无法确认无冲突 —— 这不是"通过"，是"查不到"'
      : null,
})
