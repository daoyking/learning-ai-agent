#!/usr/bin/env python3
"""从 eval-baseline-run.log 解析已完成的 [N/50] 行，生成 eval-baseline-checkpoint.json 供评测断点续跑。"""
import json
import re
import sys

LOG = "eval-baseline-run.log"
OUT = "eval-baseline-checkpoint.json"

pat = re.compile(
    r"^\[(\d+)/50\]\s+(\S+)\s+hit=([01\-]|None)\s+faithful=(true|false)\s+correct=(true|false)"
)

rows = {}
order = []
with open(LOG, encoding="utf-8") as f:
    for line in f:
        m = pat.match(line.strip())
        if not m:
            continue
        idx, qid, hit, faithful, correct = m.groups()
        hit_v = None if hit in ("-", "None") else int(hit)
        rows[qid] = {
            "id": qid,
            "category": qid.split("-")[1] if "-" in qid else "fact",
            "retrievalHit": hit_v,
            "faithful": faithful == "true",
            "correct": correct == "true",
            "answer": "",
            "reason": "(复用前次运行结果)",
            "resumed": True,
        }
        order.append(qid)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"order": order, "rows": rows}, f, ensure_ascii=False, indent=2)

print(f"parsed {len(rows)} completed questions -> {OUT}")
