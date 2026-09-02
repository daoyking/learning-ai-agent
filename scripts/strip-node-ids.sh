#!/usr/bin/env bash
# strip-node-ids.sh — 清掉 HTML 里被外部可视化编辑器注入的 data-page-node-id 属性
#
# 背景：某些可视化 HTML 编辑器（设计/建站类工具）打开本文件时会往每个标签上
#       注入 data-page-node-id="xxxx" 随机 ID，导致 284 行全部变脏、文件从
#       44.7KB 涨到 64.4KB，但**文本内容零变化**。这类污染会：
#         - 淹没真实 diff，code review 无法进行
#         - 一旦误提交，会被同步到 gh-pages 线上
#
# 本脚本幂等：没污染时不动文件，有污染时清干净。
#
# Usage:
#   ./scripts/strip-node-ids.sh            # 清理 index.html（默认）
#   ./scripts/strip-node-ids.sh resume.html
#
# 退出码：0 = 无变化或已清理；2 = 清理后与 git HEAD 仍不一致（需人工看一眼）

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-index.html}"
F="$ROOT/$TARGET"

[ -f "$F" ] || { echo "文件不存在：$F" >&2; exit 1; }

BEFORE=$(wc -c < "$F" | tr -d ' ')
COUNT=$(grep -o 'data-page-node-id' "$F" 2>/dev/null | wc -l | tr -d ' ')

if [ "$COUNT" -eq 0 ]; then
  echo "✓ $TARGET 无 data-page-node-id 污染（${BEFORE} B），无需处理"
  exit 0
fi

TMP=$(mktemp "${TMPDIR:-/tmp}/strip.XXXXXX.html")
# 只删除「空白 + data-page-node-id="..."」整体，不留多余空格
sed -E 's/[[:space:]]+data-page-node-id="[A-Za-z0-9_-]+"//g' "$F" > "$TMP"

AFTER=$(wc -c < "$TMP" | tr -d ' ')
REMAIN=$(grep -o 'data-page-node-id' "$TMP" 2>/dev/null | wc -l | tr -d ' ')

if [ "$REMAIN" -ne 0 ]; then
  echo "✗ 清理后仍残留 $REMAIN 处，未写回（保留原文件）" >&2
  rm -f "$TMP"
  exit 2
fi

cp "$TMP" "$F"
rm -f "$TMP"
echo "✓ 已清理 $TARGET：移除 $COUNT 处属性，${BEFORE} B → ${AFTER} B"

# 与 git HEAD 比对，确认只清掉了属性、没有动别的
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$ROOT" diff --quiet -- "$TARGET"; then
    echo "✓ 与 git HEAD 逐字节一致——确认只清掉了注入属性，内容无损失"
    exit 0
  else
    echo "! 清理后与 git HEAD 仍有差异，请人工确认：git -C $ROOT diff -- $TARGET" >&2
    exit 2
  fi
fi

exit 0
