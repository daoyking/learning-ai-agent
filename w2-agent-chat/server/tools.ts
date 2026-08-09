import { tool } from 'ai';
import { z } from 'zod';
import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 沙箱根目录：readFile 只能读取本目录内的文件，避免任意路径穿越
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, 'docs');

// 极简安全计算器：仅允许数字与基础运算符，拒绝任意代码执行
function safeCalc(expr: string): number | null {
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${expr});`);
    const val = fn();
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

// —— 真实天气：Open-Meteo（免费、无需 API key）——
// 步骤 1：城市名 → 经纬度（geocoding）
async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city,
  )}&count=1&language=zh&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const j = await resp.json();
  const f = j?.results?.[0];
  if (!f) return null;
  return { lat: f.latitude, lon: f.longitude, name: f.name };
}

// WMO weather code → 中文
const WMO: Record<number, string> = {
  0: '晴',
  1: '大致晴朗',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '强雷暴',
};

// 步骤 2：经纬度 → 实时天气
async function getWeatherReal(city: string): Promise<Record<string, unknown>> {
  const geo = await geocodeCity(city);
  if (!geo) {
    return { error: `找不到城市「${city}」，试试英文或拼音（如 Beijing / Shanghai）` };
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&timezone=Asia%2FShanghai`;
  const resp = await fetch(url);
  if (!resp.ok) return { error: `天气服务错误 HTTP ${resp.status}` };
  const j = await resp.json();
  const c = j?.current;
  if (!c) return { error: '天气数据缺失' };
  return {
    city: geo.name,
    weather: WMO[c.weather_code] ?? `天气代码 ${c.weather_code}`,
    temp: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    time: c.time,
  };
}

export const tools = {
  getCurrentTime: tool({
    description: '获取当前的日期和时间（北京时间）',
    inputSchema: z.object({}),
    execute: async () => {
      return {
        time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      };
    },
  }),

  calculator: tool({
    description: '计算一个算术表达式，例如 "12 * (3 + 4)"',
    inputSchema: z.object({
      expression: z.string().describe('算术表达式，仅含数字与 + - * / ( )'),
    }),
    execute: async ({ expression }) => {
      const result = safeCalc(expression);
      if (result === null) return { error: '无法计算该表达式，请检查格式' };
      return { expression, result };
    },
  }),

  getWeather: tool({
    description:
      '查询某个城市的实时天气（真实数据，来自 Open-Meteo，无需 API key）。' +
      '支持中文/英文/拼音城市名，例如 北京 / Shanghai / Beijing。',
    inputSchema: z.object({
      city: z.string().describe('城市名，例如 北京 / Shanghai / Beijing'),
    }),
    execute: async ({ city }) => getWeatherReal(city),
  }),

  // —— 真实工具：沙箱读本地文件（无需额外 API key）——
  readFile: tool({
    description:
      '读取 server/docs/ 目录下的某个文档（如 agent-guide.md），返回其文本内容。' +
      '用于让 Agent 基于本地文件回答问题。',
    inputSchema: z.object({
      filename: z
        .string()
        .describe('相对于 server/docs/ 的文件名，例如 "agent-guide.md"'),
    }),
    execute: async ({ filename }) => {
      // 防路径穿越：解析后必须仍在 DOCS_ROOT 内
      const target = resolve(DOCS_ROOT, filename);
      if (relative(DOCS_ROOT, target).startsWith('..')) {
        return { error: '路径不合法：只能读取 server/docs/ 内的文件' };
      }
      try {
        const content = await fsReadFile(target, 'utf-8');
        return { filename, bytes: content.length, content };
      } catch (e) {
        return { error: `读取失败：${(e as Error).message}` };
      }
    },
  }),

  // —— 真实工具：抓取网页正文（无需额外 API key，走 Node 全局 fetch）——
  fetchUrl: tool({
    description:
      '抓取一个网页 URL 并返回其纯文本正文（已去除 HTML 标签并截断）。' +
      '用于让 Agent 基于实时网络内容回答问题。',
    inputSchema: z.object({
      url: z.string().url().describe('要抓取的网页地址，例如 https://example.com'),
    }),
    execute: async ({ url }) => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (learning-agent-demo)' },
        });
        if (!resp.ok) return { error: `HTTP ${resp.status} ${resp.statusText}` };
        const html = await resp.text();
        // 轻量 HTML→文本：去 script/style、去标签、压缩空白、截断
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        return { url, chars: text.length, text };
      } catch (e) {
        return { error: `抓取失败：${(e as Error).message}` };
      }
    },
  }),
};
