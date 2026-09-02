#!/usr/bin/env bash
# preflight.sh — 录屏 / 现场演示前的一键自检
#
# 用途：在录屏（或面试现场演示）前 30 秒确认四个工程都能跑起来，
#       避免录到一半发现 .env 空了 / 依赖没了 / 端口被占。
#
# Usage:
#   ./scripts/preflight.sh          # 快速检查（秒级，不跑测试）
#   ./scripts/preflight.sh --test   # 完整检查（额外跑四个工程的 npm test，约 1–2 分钟）
#
# 退出码：0 = 全部就绪；1 = 存在阻塞项（BLOCK）

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORTFOLIO_DIR="$(cd "$ROOT/.." && pwd)"
RUN_TEST=0
[ "${1:-}" = "--test" ] && RUN_TEST=1

BLOCK=0
WARN=0

# 终端色（非 TTY 时自动关闭）
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; Z=$'\033[0m'
else
  G=""; R=""; Y=""; D=""; Z=""
fi

ok()   { printf "  ${G}✓${Z} %s\n" "$1"; }
warn() { printf "  ${Y}!${Z} %s\n" "$1"; WARN=$((WARN+1)); }
bad()  { printf "  ${R}✗${Z} %s\n" "$1"; BLOCK=$((BLOCK+1)); }

# 取 .env 里第一个非空 key 值（脱敏，只显示前 6 位 + 长度）
mask_key() {
  local v="$1"
  local len=${#v}
  if [ "$len" -eq 0 ]; then echo "(空)"; else echo "${v:0:6}…(${len}位)"; fi
}

check_project() {
  local d="$1" name="$2" port="$3" start="$4"
  local dir="$PORTFOLIO_DIR/$d"
  printf "\n${D}──${Z} %s ${D}(%s)${Z}\n" "$name" "$d"

  [ -d "$dir" ] || { bad "目录不存在：$dir"; return; }

  # .env
  if [ -f "$dir/.env" ]; then
    local key
    key=$(grep -hoE '^[A-Z0-9_]*(API_KEY|AUTH_TOKEN)=.+$' "$dir/.env" | head -1 | sed -E 's/^[^=]+=//')
    key=$(printf '%s' "$key" | tr -d "\"'" | tr -d '[:space:]')
    if [ -n "$key" ]; then
      ok ".env 已填 key：$(mask_key "$key")"
    else
      bad ".env 存在但没有有效 key（录屏时 W2/W3/W4 会调用失败）"
    fi
  else
    bad ".env 缺失 → cp $d/.env.example $d/.env 后填 key"
  fi

  # 依赖
  if [ -d "$dir/node_modules" ]; then
    ok "依赖已安装"
  else
    bad "node_modules 缺失 → (cd $d && npm install)"
  fi

  # 端口占用（录屏时若被旧进程占着，dev server 会静默换端口）
  if command -v lsof >/dev/null 2>&1 && [ -n "$port" ]; then
    local pid
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
      warn "端口 $port 已被占用（pid $pid）——启动前先 kill，避免打开的是旧页面"
    else
      ok "端口 $port 空闲"
    fi
  fi

  # 启动命令提示
  printf "     ${D}启动：cd %s && %s${Z}\n" "$d" "$start"

  # 离线测试
  if [ "$RUN_TEST" = "1" ]; then
    local out rc
    out=$(cd "$dir" && npm test 2>&1); rc=$?
    if [ $rc -eq 0 ]; then
      local pass
      pass=$(echo "$out" | grep -oE '[0-9]+ (passed|passing|✓)' | head -1)
      ok "npm test 通过（${pass:-绿}）"
    else
      bad "npm test 失败（rc=$rc）——录屏前必须修好"
    fi
  fi
}

printf "\n${D}═══ W6 作品集 · 录屏前自检 ═══${Z}\n"
printf "${D}作品集根目录：%s${Z}\n" "$PORTFOLIO_DIR"

# 0. 先清掉可视化编辑器注入的 data-page-node-id（幂等，无污染时秒退）
if [ -x "$ROOT/scripts/strip-node-ids.sh" ]; then
  STRIP_OUT=$("$ROOT/scripts/strip-node-ids.sh" index.html 2>&1)
  case "$STRIP_OUT" in
    *"已清理"*) printf "\n${Y}自动清理${Z}：%s\n" "$STRIP_OUT" ;;
  esac
fi

# 1. 作品集本体
printf "\n${D}──${Z} 作品集页面\n"
for f in index.html resume.html README.md screencast-checklist.md; do
  if [ -f "$ROOT/$f" ]; then
    ok "$f（$(wc -c < "$ROOT/$f" | tr -d ' ') B）"
  else
    bad "$f 缺失"
  fi
done

# 线上一致性提示
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$ROOT" status --porcelain -- index.html resume.html README.md)" ]; then
    warn "index/resume/README 有未提交改动——录屏前记得 commit 并同步 gh-pages，否则线上与本地不一致"
  else
    ok "三个主文件与 git HEAD 一致"
  fi
fi

# 1–4. 四个工程
check_project "w2-agent-chat"     "W2 流式聊天 + 工具调用" "5173" "npm run dev  → http://localhost:5173"
check_project "w3-rag-qa"         "W3 RAG 检索问答"        "5174" "npm run dev  → http://localhost:5174"
check_project "w4-resume-scorer"  "W4 Mastra 多步编排"     ""     "npm start"
check_project "w5-agent-eval"     "W5 评测 + 可观测"       ""     "npm run demo（离线）/ npm run eval（真实）"

# 汇总
printf "\n${D}═══ 汇总 ═══${Z}\n"
if [ "$RUN_TEST" = "0" ]; then
  printf "  阻塞项：%s    提醒项：%s\n" "$BLOCK" "$WARN"
  printf "  ${D}（加 --test 可额外跑四个工程的离线 npm test）${Z}\n"
else
  printf "  阻塞项：%s    提醒项：%s\n" "$BLOCK" "$WARN"
fi

if [ "$BLOCK" -eq 0 ]; then
  printf "  ${G}就绪，可以开始录屏${Z} 🎬\n\n"
  exit 0
else
  printf "  ${R}有 %s 项阻塞，先按上面的提示修掉再录${Z}\n\n" "$BLOCK"
  exit 1
fi
