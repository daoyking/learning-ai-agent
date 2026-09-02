# Playbook DSL 与执行引擎设计 v0.1

> LSH 的护城河。目标：把"我踩过的坑"变成机器可复用的**诊断知识**。
> 状态：设计定稿，DSL 已落地（schema + 13 个剧本），引擎待实现（V0.2）。

---

## 一、设计目标与三条硬原则

### 1.1 目标

把排障经验从"散在 skill 文档里的自然语言的段落"变成：

```
症状（可观测） → 证据（可复现） → 根因（可推理） → 修复（可回滚） → 验证（可确认）
```

### 1.2 三条硬原则（违反任何一条的剧本不予入库）

**① 证据优先，禁止臆测**
结论必须携带 `evidence`——每一条都是一条真实命令加它的输出。
没有证据链的剧本只能输出"疑似"，不能输出"根因"。

> 这条来自真实教训：OmniRoute 供应商批量失败时，第一反应是"供应商挂了"，
> 实际是幽灵代理端口。缺了证据链，就会去改一堆无关配置。

**② 诊断只读，修复分档**
`diagnose` 阶段的每一步都必须是只读的（`exec` 只允许 `SELECT`/`cat`/`env`/`grep` 等）。
修复单独放在 `fix` 段，且分三档执行权限（见 §5）。

**③ 一切写操作可回滚**
任何 `fix.steps[*].snapshot: true` 的步骤在执行前必须先快照。
`requires_sudo: true` 的剧本引擎只展示命令，永不代执行（`pmset` 这类系统设置尤其如此）。

---

## 二、DSL 总览：五段式

```yaml
schema: lsh.playbook/v1
id: omniroute-ghost-proxy
title: 幽灵代理端口导致供应商集体失败
service: omniroute
severity: high
category: network

trigger:    # 什么时候认为"这个剧本可能命中了"
diagnose:   # 只读取证
conclude:   # 基于证据推导根因
fix:        # 修复（分档）
verify:     # 修完怎么确认真的好了
rollback:   # 修坏了怎么退回去
```

只有 `trigger` / `diagnose` / `conclude` 是必填——
**一个只有前三段的剧本依然是有效剧本**（纯诊断，V0.2 就靠这个）。

---

## 三、表达式语言（expr）

断言散落在 `trigger.*.when`、`conclude[].when`、`verify.expect` 里。
**绝不使用 `eval` 或任何宿主语言的运行时求值**——用固定语法的白名单解析器。

### 3.1 语法子集

| 类别 | 支持 |
|---|---|
| 字面量 | 数字 `0` `3.5` · 字符串 `'en-US'` · 布尔 `true/false` · `null` |
| 变量 | 诊断捕获量 `live` `proxy_rows` · 探针字段 `results.count` · 环境 `${env:HTTP_PROXY}` |
| 比较 | `==` `!=` `>` `>=` `<` `<=` |
| 逻辑 | `and` `or` `not` · 括号分组 |
| 成员 | `in` （右侧为数组字面量） |
| 正则 | `matches 'ECONNREFUSED|fetch failed'` |
| 函数 | `len(x)` `count(x)` `exists(x)` `contains(x, 'y')` `age_minutes(x)` |

### 3.2 明令禁止

- 任意函数调用、方法链、属性深访问（限制深度 ≤ 2）
- 字符串拼接、算术运算（`a + b`）— 需要时改成两步 capture
- 赋值、闭包、控制流

**理由**：剧本未来要支持从社区导入。一个图灵完备的表达式语言等于给导入的 YAML 开了后门。

### 3.3 解析与求值

```
expr 字符串 → Lexer → Pratt Parser → AST → 白名单校验 → 求值(只读 ctx)
```

AST 节点只有 6 种：`Literal` `Var` `Unary` `Binary` `Call` `Paren`。
`Call` 的 callee 必须在内置函数表里；`Var` 的解析路径深度 > 2 直接拒绝。

---

## 四、触发系统（trigger）

三种**且仅三种**条件来源，都必须是可观测事实：

| 来源 | 写法 | 说明 |
|---|---|---|
| 探针结果 | `probe: omniroute.providers-live` + `when: 'live == 0'` | 引用 `服务id.探针id` |
| 日志匹配 | `log_match: {source, pattern, window, count}` | 滑动窗口内命中 N 次 |
| 命令断言 | `cmd: {run, expect_exit, expect_output}` | 兜底手段，低频跑 |

组合：`any_of` / `all_of`。
`cooldown_ms`（默认 10 分钟）防止同一剧本反复弹窗——
崩溃循环时不冷却会在 1 分钟内刷出上百条告警。

**触发不等于确诊。** 触发只是"值得跑一下诊断"，根因要等 `conclude` 阶段。

---

## 五、修复的三档执行模式（安全模型核心）

| 模式 | 行为 | 启用版本 | 准入条件 |
|---|---|---|---|
| `manual` | 只输出结论 + 命令，用户自己复制去终端跑 | **V0.2（默认）** | 全部 |
| `assisted` | 快照 → diff 预览 → 二次确认 → 执行 → 验证 → 失败自动回滚 | V0.3 | `risk ≤ medium` |
| `auto` | 无人值守自动执行 | V0.3+ | `risk == low` **且** `side_effects == none` |

### 5.1 无论哪档都强制的规则

1. `requires_sudo: true` → **永远只给命令**（`pmset`、`launchctl bootstrap` 属此类）
2. `side_effects: deletes-data` → 强制确认，`auto` 模式禁止
3. 每个 `fix.steps[*].snapshot: true` 的步骤执行**前**必须完成快照，快照失败则中止
4. 执行完必须跑 `verify`，验证失败默认触发回滚（除非用户显式选择"保留现状"）

### 5.2 快照策略

- 普通文件：复制到 `~/.lsh/snapshots/<playbookId>/<timestamp>/`，带内容 hash
- **SQLite：必须用 `.backup` 而非文件复制** —— WAL 模式下直接 `cp` 会得到不一致的库
- plist：导出为 XML 文本便于 diff

### 5.3 diff 预览

`assisted` 模式确认弹窗必须展示将要发生的变化：

```
将修改 ~/.omniroute/storage.sqlite
  settings.proxy_enabled:  1  →  0
将执行: launchctl kickstart -k gui/501/ai.omniroute.server
快照: ~/.lsh/snapshots/omniroute-ghost-proxy/20260902-164500/
```

---

## 六、执行引擎状态机

```
                    ┌──────────────── trigger 命中 ────────────────┐
                    ↓                                              │
  [idle] ──→ [matched] ──→ [diagnosing] ──步骤失败(optional)──→ [concluded/partial]
                                  │
                                  └──全部成功──→ [concluded]
                                                     │
                    ┌────────────────────────────────┼────────────────────┐
                    ↓                                ↓                    ↓
             mode=manual                      mode=assisted          mode=auto
                    ↓                                ↓                    ↓
              [reported]                    [awaiting_confirm]      [backing_up]
               （展示命令，结束）                    │                        │
                                          确认↓    ↓取消            快照失败↓
                                    [backing_up]  [aborted]          [aborted]
                                           │
                                     [fixing] ──步骤失败──→ [fix_failed] ──→ [rolling_back]
                                           │                                      │
                                     [verifying]                            [rolled_back]
                                      │        │
                                  通过↓        ↓未通过
                              [done]   [verify_failed] ──用户选择──→ [rolling_back] | [done_with_warning]
```

**每个状态都要落库**（`PlaybookRun`），因为：
"这个剧本上周自动修过一次，这周又坏了" 本身就是重要信号——说明是复发问题，不是一次性故障。

---

## 七、引擎架构与接口

```
┌─ 前端 (React) ─────────────────────────────────────┐
│  usePlaybooks()  ── 展示匹配到的剧本                │
│  RunPanel        ── 证据链 / diff 预览 / 确认按钮    │
└────────────── Tauri IPC ───────────────────────────┘
┌─ Rust 能力层 ──────────────────────────────────────┐
│  pb::loader    解析校验剧本 YAML                    │
│  pb::matcher   触发器求值（探针结果 + 日志窗口）      │
│  pb::runner    状态机推进（可暂停在 awaiting_confirm）│
│  pb::expr      expr 解析器（非 eval）                │
│  pb::snapshot  文件 / SQLite 快照与恢复              │
└────────────────────────────────────────────────────┘
```

### 7.1 TS 侧接口（`src/types/playbook.ts`）

```ts
export interface PlaybookEngine {
  /** 找出当前状态下所有可能命中的剧本（按 severity 排序） */
  match(ctx: MatchContext): Promise<MatchedPlaybook[]>
  /** 只读取证，返回证据链 */
  diagnose(pb: Playbook, ctx: MatchContext): Promise<Diagnosis>
  /** 基于证据推导根因，可能有多条结论（置信度排序） */
  conclude(pb: Playbook, d: Diagnosis): Promise<Conclusion[]>
  /** dry-run：产出将要发生的变化，不执行任何副作用 */
  plan(pb: Playbook, c: Conclusion): Promise<FixPlan>
  /** 真正执行（内部强制快照 + verify + 失败回滚） */
  execute(plan: FixPlan, opts: { confirmed: boolean }): Promise<RunResult>
  /** 回滚某次执行 */
  rollback(runId: string): Promise<void>
}
```

`plan()` 与 `execute()` 分离是关键——
UI 永远先拿 plan 渲染 diff 预览，用户确认后才调 execute。

### 7.2 数据结构

```ts
interface Diagnosis {
  steps: { id: string; title: string; cmd: string; output: string; exit: number }[]
  vars: Record<string, unknown>   // capture 捕获的变量
  partial: boolean                 // 有 optional 步骤失败
}

interface Conclusion {
  rootCause: string
  confidence: 'low' | 'medium' | 'high'
  evidence: string[]               // 每条 = 命令 + 输出摘要
  recommendedFix?: string
}

interface FixPlan {
  snapshotDir: string
  changes: { type: string; target: string; before?: string; after?: string }[]
  commands: string[]
  requiresSudo: boolean
  risk: 'low' | 'medium' | 'high'
}
```

---

## 八、风险分级矩阵

| risk | side_effects | 可执行模式 | 确认要求 |
|---|---|---|---|
| low | none | manual / assisted / auto | 无需 |
| low | restart-service | manual / assisted | 轻量确认 |
| medium | writes-config | manual / assisted | **diff 预览 + 显式确认** |
| medium | restart-service | manual / assisted | 影响面提示 |
| high | 任意 | **仅 manual** | — |
| 任意 | deletes-data | manual / assisted | 强制确认 + 快照 |
| 任意 | system-setting（sudo） | **仅 manual，只给命令** | — |

---

## 九、已落地的 13 个剧本

| id | 服务 | 触发 | 根因 | 修复档位 |
|---|---|---|---|---|
| `proxy-dead` | proxy | 出网实测失败 | 代理进程在但规则失效/订阅过期 | manual |
| `omniroute-ghost-proxy` | omniroute | 可用供应商 = 0 | 数据库开代理但端口无进程（幽灵端口） | assisted |
| `omniroute-testall-pollution` | omniroute | `last_error` 含 "test not supported" | 测试动作污染了 `test_status` | assisted |
| `searxng-no-result` | searxng | 搜索结果为本地化垃圾 | `default_lang` 非 en-US → Bing 按 IP 猜地区 | assisted |
| `searxng-timeout` | searxng | 引擎超时 | `request_timeout` 默认 3s 必超时 | assisted |
| `odysseus-embedding-lane` | odysseus | 无 embedding lane | `.env` 缺 `EMBEDDING_URL`/`MODEL` | assisted |
| `chromadb-empty-store` | chromadb | collections = 0 | 启动未带 `--path` → 建了新空库 | manual（数据恢复需人工） |
| `openclaw-version-skew` | openclaw | `Unrecognized key` 拒绝启动 | 配置 `meta.migrations` 版本超前 | assisted |
| `openclaw-plugin-corrupt` | openclaw | 插件校验失败但端口在 | 插件文件损坏 | assisted |
| `dsh-duplicate-loader` | dsh | `duplicate loader entry id` | 两个插件声明同名 loader entry | manual |
| `dsh-npm-prefix` | dsh | 插件装不上 | npm prefix 被其他工具改过 | manual |
| `host-frozen` | 环境 | 日志出现 `host timing gap` | macOS Maintenance Sleep | **manual + sudo**（只给命令） |
| `log-explosion` | 多服务 | 单日志文件 > 20MB | KeepAlive 崩溃循环 | assisted |

---

## 十、落地节奏

| 版本 | 能力 |
|---|---|
| **V0.2** | 剧本加载 + 触发匹配 + **只读诊断**（结论 + 证据链 + 给命令）。所有剧本强制按 `manual` 处理，忽略 YAML 里的 `mode`。 |
| **V0.3** | 快照 / diff 预览 / 二次确认 / 执行 / 验证 / 回滚。`assisted` 解禁，`auto` 仅对 `risk=low && side_effects=none` 开放。 |
| **V0.4** | 复发检测（同一剧本短期内多次命中 → 提示根因未解决）；剧本集市与导入导出。 |

---

## 附录：写一个新剧本的检查清单

- [ ] `trigger` 的三种来源里至少用了一个，且都是可观测事实
- [ ] `diagnose` 每一步都只读，没有 `rm`/`UPDATE`/`sed -i`
- [ ] `conclude` 每条结论都带 `evidence`，且 evidence 是"命令 + 输出"而非推断
- [ ] `fix.steps` 里涉及写文件/改库的步骤 `snapshot: true`
- [ ] 需要 sudo 的步骤标了 `requires_sudo: true` 且 `mode: manual`
- [ ] 有 `verify`，能证明"修完确实好了"
- [ ] `source` 字段写清这条经验从哪来（哪个 skill、哪次实测、什么日期）
