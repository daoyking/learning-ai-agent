#!/usr/bin/env node
/**
 * 零依赖生成 LSH 图标（纯 Node，手写 PNG 编码器）。
 * 图案语义：深色面板 + 三个状态灯（绿 / 琥珀 / 灰）—— 就是产品的核心隐喻。
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const off = y * (width * 4 + 1)
    raw[off] = 0 // filter: none
    rgba.copy(raw, off + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 绘图 ----------
class Canvas {
  constructor(size) {
    this.size = size
    this.px = Buffer.alloc(size * size * 4)
  }
  set(x, y, [r, g, b, a = 255]) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const i = (y * this.size + x) * 4
    // 简单 alpha 合成
    if (a >= 255) {
      this.px[i] = r
      this.px[i + 1] = g
      this.px[i + 2] = b
      this.px[i + 3] = 255
      return
    }
    const sa = a / 255
    this.px[i] = Math.round(this.px[i] * (1 - sa) + r * sa)
    this.px[i + 1] = Math.round(this.px[i + 1] * (1 - sa) + g * sa)
    this.px[i + 2] = Math.round(this.px[i + 2] * (1 - sa) + b * sa)
    this.px[i + 3] = Math.max(this.px[i + 3], a)
  }
  roundRect(x, y, w, h, r, color) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const dx = Math.min(px - x, x + w - 1 - px)
        const dy = Math.min(py - y, y + h - 1 - py)
        if (dx < r && dy < r) {
          const d = Math.hypot(r - dx, r - dy)
          if (d > r) continue
        }
        this.set(px, py, color)
      }
    }
  }
  circle(cx, cy, r, color) {
    for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
      for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
        if (Math.hypot(px - cx, py - cy) <= r) this.set(px, py, color)
      }
    }
  }
  toPng() {
    return encodePng(this.size, this.size, this.px)
  }
}

const BG = [11, 15, 20, 255]
const PANEL = [26, 34, 45, 255]
const GREEN = [34, 197, 94, 255]
const AMBER = [245, 158, 11, 255]
const GRAY = [100, 116, 139, 255]
const SLATE = [148, 163, 184, 255]

function drawIcon(size) {
  const s = size / 128
  const c = new Canvas(size)
  c.roundRect(0, 0, size, size, 26 * s, BG)

  // 三张"服务卡片"
  const rows = [
    { y: 30, light: GREEN },
    { y: 58, light: AMBER },
    { y: 86, light: GRAY },
  ]
  for (const row of rows) {
    c.roundRect(26 * s, row.y * s, 76 * s, 18 * s, 5 * s, PANEL)
    c.circle(38 * s, (row.y + 9) * s, 4.5 * s, row.light)
    c.roundRect(50 * s, (row.y + 7.5) * s, 44 * s, 3 * s, 1.5 * s, SLATE)
  }
  return c.toPng()
}

/** macOS 托盘用 template 图：只关心 alpha，颜色必须是纯黑 */
function drawTray(size) {
  const s = size / 22
  const c = new Canvas(size)
  const BLACK = [0, 0, 0, 255]
  c.roundRect(3 * s, 3 * s, 16 * s, 4 * s, 1.5 * s, BLACK)
  c.circle(6 * s, 5 * s, 1.6 * s, BLACK)
  c.roundRect(3 * s, 9 * s, 16 * s, 4 * s, 1.5 * s, BLACK)
  c.circle(6 * s, 11 * s, 1.6 * s, BLACK)
  c.roundRect(3 * s, 15 * s, 16 * s, 4 * s, 1.5 * s, BLACK)
  c.circle(6 * s, 17 * s, 1.6 * s, BLACK)
  return c.toPng()
}

mkdirSync(OUT, { recursive: true })

const targets = [
  ['32x32.png', drawIcon(32)],
  ['128x128.png', drawIcon(128)],
  ['128x128@2x.png', drawIcon(256)],
  ['icon.png', drawIcon(512)],
  ['tray.png', drawTray(22)],
  ['tray@2x.png', drawTray(44)],
]

for (const [name, buf] of targets) {
  writeFileSync(join(OUT, name), buf)
  console.log(`  ✓ icons/${name}  (${buf.length} bytes)`)
}

console.log('\n图标已生成。生成 .icns：')
console.log('  mkdir -p /tmp/lsh.iconset')
console.log('  cp src-tauri/icons/icon.png /tmp/lsh.iconset/icon_512x512.png')
console.log('  iconutil -c icns /tmp/lsh.iconset -o src-tauri/icons/icon.icns')
