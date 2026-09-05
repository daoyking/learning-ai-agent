# Local Service Hub (LSH)

macOS 上的**本地自托管 AI 服务控制中心**。

不是端口监控器——是能回答"这个服务**真的能用吗**"的语义级控制中心。

```
本机实况：47 个监听端口 · 9 个纳管服务 · 7 个在线
```

---

## 快速开始

```bash
# 安装依赖
pnpm install

# 浏览器预览（读本机真实快照，不需要 Tauri runtime）
pnpm snapshot      # 扫描本机 → public/snapshot.json
pnpm dev           # http://localhost:1420

# 桌面应用（走 Rust 实时扫描）
pnpm tauri:dev

# 改完 manifest / playbook 后必跑
pnpm validate:manifests
```

> **为什么浏览器里也能看到真实数据？**
> `scripts/snapshot.mjs` 会真的跑 `lsof` 扫描本机，生成 `public/snapshot.json`。
> `src/lib/api.ts` 检测不到 Tauri runtime 时自动读它——所以预览界面里的
> 服务状态就是本机真实状态，不是假数据。

---

## 目录结构

```
lsh/
├── manifests/
│   ├── schema/
│   │   ├── service-manifest.schema.json   # 服务描述格式（JSON Schema 2020-12）
│   │   └── playbook.schema.json           # 排障剧本格式
│   ├── services/*.yaml                    # 9 个服务的声明式描述
│   └── playbooks/*.yaml                   # 13 个排障剧本
├── src/                                   # React 前端
├── src-tauri/                             # Rust 能力层
├── scripts/
│   ├── validate-manifests.mjs             # 校验 manifest + playbook + 依赖图
│   ├── snapshot.mjs                       # 本机扫描 → 快照（浏览器 fallback）
│   └── make-icons.mjs                     # 零依赖生成图标（手写 PNG 编码器）
└── docs/PLAYBOOK-DSL.md                   # Playbook DSL 与执行引擎设计
```

---

## Manifest：一个服务 = 一份 YAML

```yaml
id: omniroute
supervisor: { kind: launchd, label: ai.omniroute.server }
health:
  l1: { type: tcp, port: 20128 }
  l2: { type: http, url: 'http://127.0.0.1:20128/v1/models', expect_status: 200 }
  l3: [{ id: providers-live, type: script, script: probes/omniroute-providers.mjs }]
depends_on: [proxy]
playbooks: [omniroute-ghost-proxy, omniroute-testall-pollution]
```

**五种 supervisor 抽象**（这是整个系统的地基）：

| kind | 用于 | 关键约束 |
|---|---|---|
| `launchd` | OmniRoute / OpenClaw | **只 kickstart 已注册 job，绝不 bootstrap** |
| `docker` | SearXNG | settings.yml 只读挂载，改完必须重启容器 |
| `app` | Ollama / AnythingLLM / ClashX | 判断存活以主端口为准，别信代理 job |
| `script` | Odysseus / ChromaDB | 必须 `setsid` 脱离进程组，`nohup &` 会被会话回收 |
| `pty` | dsh | 见下 |

### dsh 的 TTY 问题（V0.1 已解决）

dsh-tui 会校验 TTY，`nohup dsh web &` 直接崩。
**macOS 自带 `/usr/bin/script` 就是现成的 pty 分配器**，不需要 `portable-pty`：

```bash
script -q /tmp/dsh-web-pty.log /Users/jindy/.local/bin/dsh web
```

你的 `com.jindy.dsh-web.plist` 已经在用这个技巧。客户端的策略是：
job 已注册 → `launchctl kickstart`（内部自带 pty）；
未注册 → 自己用 `script -q` 包一层 + setsid 脱离进程组。
只有需要**交互式写入**（发 Ctrl-C、应答 prompt）时才升级到 `portable-pty`。

### 受管 shell 里启动服务的存活问题（2026-09-04 实测）

在 AI Agent / CI 这类**受管 shell** 里启服务，进程会随 shell 会话被回收 —— 日志里
没有任何报错，只是到某一行戛然而止，极易误判为"服务崩溃了"。实测结论：

| 启动方式 | 是否存活 | 说明 |
|---|---|---|
| `nohup cmd &` | ❌ | 同进程组，会话结束即被回收 |
| `nohup script -q log cmd &` | ⚠️ | 能活，但**加 `< /dev/null` 会让 script 读到 EOF 退出** |
| `python3 os.fork() + os.setsid()` | ✅ | 新会话，与调用方完全脱离 |

> `setsid` 在 macOS 上不存在，用 Python 的 `os.setsid()`（或 `subprocess` 的
> `start_new_session=True`）是等价且零依赖的做法。

### launchctl bootstrap 在受管 shell 里不可用

`launchctl bootstrap gui/$UID <plist>` 会稳定报 **`Bootstrap failed: 5: Input/output error`**，
且**与 plist 内容无关** —— 用最小化合法 plist 验证同样失败。原因是调用进程不在用户的
Aqua GUI 会话里，拿不到 gui domain 的 bootstrap 权限（读操作如 `launchctl print` /
`print-disabled` 都正常，只有写操作失败）。

**含义**：LSH 的「注册 / 启动」动作必须由 GUI 上下文发起 —— 也就是 LSH 应用自己的窗口，
或 Terminal.app。这也是为什么不能靠脚本批量注册 job。

---

## 三级健康探针：判据只有一条

| 级别 | 判据 | 回答什么 |
|---|---|---|
| L1 | TCP 端口可连 | 进程还在吗 |
| L2 | HTTP 状态码/响应体 | 接口答得上来吗 |
| L3 | 真的发出请求并拿到正确结果 | **真的能用吗** |

> **L1/L2 绿灯但 L3 红灯 = 假活。UI 必须琥珀色，绝不能显示绿。**

本机已知的三类假活（都只能靠 L3 发现）：

1. **OmniRoute** — 35 个供应商 `is_active=1`，实发请求 **0 个可用**（幽灵代理端口）
2. **Odysseus** — `/api/models` 报 0 是假象，要穿透查 `/api/model-endpoints/{id}/models`
3. **SearXNG** — 健康接口 200，但 `default_lang` 不对时返回全本地化垃圾结果

### L3 很贵，这是设计约束不是缺陷

L3 会**真的**发请求：ollama 跑一次完整推理、searxng 真搜一次、openclaw 冷启动
CLI 做插件体检、turn-latency 真跑一个 agent turn。2026-09-05 实测 14 个探针
墙钟 **122s**（探针耗时合计 189s，并发后压缩到 122s）。单项最贵的：

| 探针 | 耗时 | 贵在哪 |
|---|---|---|
| `openclaw.plugin-integrity` | 113s | OpenClaw CLI 冷启动 40s+，还要跑三层检查 |
| `openclaw.turn-latency` | 34s | 真跑一个 agent turn |
| `omniroute.providers-live` | 13s | 逐个拨测供应商 |
| `ollama.inference-works` | 10s | 真跑一次推理 |

因此：

- **L3 不随启动自动跑**，由顶部「L3 深度体检」手动触发（带秒表），卡片「深检」单服务复测
- 后端已并发化（`L3_PARALLELISM = 6`，分块并行保序），但受最长那根探针限制
  （阿姆达尔定律：openclaw 一根就占 113s），收益约 1.5x
- 调探针耗时用 `cargo test --test l3_timing -- --nocapture`

> **判读技巧**：某探针耗时 ≈ 它 manifest 里的 `timeout_ms`，说明它是被超时砍掉的，
> 表现为「输出非 JSON」假失败，而不是真的慢。这正是 openclaw 那个探针踩过的坑。

---

## Playbook：把踩过的坑变成可执行诊断

13 个剧本，全部来自本机真实故障记录。五段式：

```
trigger（可观测症状） → diagnose（只读取证） → conclude（带证据链的根因）
                     → fix（分档执行） → verify + rollback
```

三条硬原则：
1. **证据优先** — 没有 evidence 的结论只能说"疑似"，不能说"根因"
2. **诊断只读** — diagnose 阶段禁止任何写操作
3. **写操作可回滚** — `requires_sudo: true` 的剧本只给命令，永不代执行

执行档位：`manual`（只给命令，V0.2 默认）→ `assisted`（快照+diff+确认，V0.3）→ `auto`（仅 low risk）

详见 [`docs/PLAYBOOK-DSL.md`](./docs/PLAYBOOK-DSL.md)。

---

## 当前进度

### ✅ 已完成

- [x] **Manifest schema + 9 个服务 YAML**（全部通过 JSON Schema 校验）
- [x] **Playbook schema + 13 个剧本**
- [x] **Tauri 2 + React + TS 工程骨架**（`cargo check` 通过，`pnpm build` 通过）
- [x] **最小闭环跑通**：扫描本机端口 → 合并 manifest → 渲染服务卡片
- [x] 依赖图校验（引用完整性 + 无环）
- [x] 未纳管端口自动发现
- [x] 启停命令 dry-run 预览
- [x] L3 语义探针引擎：4 种类型（script/http_json/llm_echo/container_exec）+ assert 作用域
- [x] 14 个 L3 探针脚本落地（**12/14 通过**；未过的 2 个属预期：anythingllm 未启动、chromadb 无 collection）
- [x] Playbook 引擎：expr 白名单解析器 + matcher + diagnose + apply_fix（含快照/回滚）
- [x] 五种 supervisor 真实启停（setsid/pty/launchd/docker/app）
- [x] 日志中心（多源 tail + copytruncate 轮转）
- [x] 环境体检 Doctor
- [x] 托盘常驻（三色状态：绿/黄/红）
- [x] 一键修复 UI（二次确认弹窗 + 执行进度 + 修复后复诊）
- [x] NO_PROXY 注入修复（沙箱代理劫持本地请求问题）

### 🚧 待办

- [x] L2 HTTP 探针（V0.6）—— 手动触发 HTTP 健康检查，显示状态码+耗时
- [x] L2 自动扫描（V0.7）—— 启动时异步预检全部服务，头部汇总 L2 x/9 通
- [x] L2 无限循环修复 —— useEffect 移除 l2Loading 依赖，改用 useRef 幂等守卫
- [x] **openclaw gateway 实际运行验证**（2026-09-04：18789 /health → 200，webchat WS 正常）
- [x] **L3 语义探针接入 UI（V0.8）** —— 卡片显示 `✓ 2/2` 汇总、可展开看每个探针在验什么与失败原因；顶部「L3 深度体检」带秒表，卡片「深检」单服务复测
- [x] **L3 全量并发化** —— 原本串行（14 个探针逐个跑，单探针超时最高 180s），改为并发上限 6 的分块并行，实测并发收益约 1.5x
- [x] **修 llm_echo 把纳秒当毫秒** —— Ollama `eval_duration` 是纳秒且不返回 `eval_duration_ms`，导致 253.6ms 的推理被记成 253634000ms
- [x] **探针耗时改为调用侧墙钟** —— 加 `ProbeRun.ms`；探针自报的 ms 不可靠（script 的被 `apply_assert` 塞进 result 里取不到）
- [x] **修 openclaw.plugin-integrity 恒假失败** —— manifest 声明 20s 超时，实际要 56–95s，探针被砍→输出空→"非 JSON"。上调至 180s
- [x] **修 openclaw 插件注册表过期 + deepseek 插件损坏** —— gateway 因此拒绝启动。禁用该插件 + `plugins registry --refresh` 后两个探针由红转绿，L3 10/14 → **12/14**
- [ ] AnythingLLM API key 配置接入
- [ ] ChromaDB 0.6.x API bug 跟踪（降级报告已处理）
- [ ] launchd 注册：openclaw / dsh 两个 job 仍未加载（需从 LSH 窗口或 Terminal.app 手动 bootstrap）
- [ ] L3 结果持久化（现在每次开窗口都要手动重跑，30–90s）
- [ ] L3 进度事件流（现在是一次性返回，长探针期间只有秒表没有逐个完成的反馈）

---

## 环境变量

Rust 侧通过 `registry::expand()` 支持变量展开：

| 变量 | 展开为 |
|---|---|
| `${home}` | manifest 里声明的 `home` 字段 |
| `${uid}` | 当前用户 uid（`id -u`） |
| `${env:VAR}` | 环境变量 |
| `~/` | 用户家目录 |
