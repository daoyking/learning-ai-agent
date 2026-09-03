# LocalServiceHub (LSH) 产品设计文档 v0.1

> 定位：macOS 上的 **自托管 AI 服务控制中心**（Mission Control）
> 目标用户：把一堆本地/自托管 AI 服务当生产力工具用的人（开发者、AI 工程师）
> 初版设计日期：2026-09-02
> 状态：初步设计（待评审）

---

## TL;DR

| 项 | 结论 |
|---|---|
| **一句话** | 一个菜单栏常驻的客户端，把本机所有自托管 AI 服务的 **发现 / 启停 / 健康 / 日志 / 配置 / 排障** 收进一个界面 |
| **核心差异化** | 不是"端口监控器"，而是 **语义级健康探针** + **依赖拓扑** + **可执行排障 Playbook** |
| **技术选型** | Tauri 2 + React + TypeScript（Rust 只做能力层） |
| **MVP 范围** | 服务注册表 / 自动发现 / 启停 / 三级探针 / 依赖拓扑 / 统一日志 / 托盘总览 |
| **杀手锏** | 把已有的排障经验（dsh / openclaw / odysseus skill）**产品化为可自动执行的 Playbook**，竞品没有一个有这个 |

---

## 一、问题定义（基于本机实测）

### 1.1 本机服务现状（2026-09-02 实测扫描）

| 服务 | 端口 | 托管方式 | 配置格式 | 健康判据的坑 |
|---|---|---|---|---|
| **Ollama** | 11434 | GUI App 自启 | 目录模型文件 | `/api/tags` 通 ≠ 模型能跑 |
| **OmniRoute** | 20128 | LaunchAgent + zshrc 兜底 | **SQLite** + `.env` | `is_active=1` 完全不可信（35 个供应商实测 0 可用） |
| **OpenClaw Gateway** | 18789 | LaunchAgent + wrapper 脚本 | **JSON** + **SQLite**(auth) | 版本倒挂时 CLI 直接拒绝启动；插件损坏则拒绝 report ready |
| **Odysseus** | 7001 | `start.sh` 手动拉起 | `.env` | `/api/models` 的 `models=0` 是假象，须查 `/api/model-endpoints/{id}/models` |
| **ChromaDB** | 8100 | venv / uvicorn | 命令行参数 | embedding lane 未配则"起得来但用不了" |
| **SearXNG** | 8081 | **Docker 容器** | `settings.yml`(ro 挂载) | `default_lang` 非 en-US → Bing 按出口 IP 地理定位返回垃圾 |
| **AnythingLLM** | 3001 / 8888 | GUI App + LaunchAgent proxy | App 内存储 | 单服务 |
| **dsh (DeepSeek Harness)** | 3080 | **手动终端（需 TTY）** | YAML + profile 树 | dsh-tui 校验 TTY，`nohup` 启动直接崩 |
| **ClashX（代理）** | 7890 | GUI App | App 配置 | **全局前置依赖**，死了则一批供应商 `fetch failed` |

### 1.2 六个真实痛点

**① 托管方式碎片化，没有统一抽象**
4 种托管形态（launchd / Docker / GUI App / shell 脚本 + 手动 TTY）并存，各自一套启停命令。

**② "活着" ≠ "能用"**
端口通只是 L1。真实故障都是 L2/L3 层的：
- OmniRoute 端口 200，但所有供应商因「幽灵代理端口（已退出进程遗留的 `HTTP_PROXY`）」集体 `ECONNREFUSED`
- Odysseus 端口 200，但 `/api/models` 报 0 个模型（假象）
- OpenClaw Gateway 端口 200，但本地模型 agent turn 要 280s（直连只要 6.1s，差 46 倍）

**③ 依赖关系是隐式的**
Odysseus ← ChromaDB + SearXNG + Ollama(nomic-embed)；OpenClaw ← Ollama/OmniRoute + 代理 7890；OmniRoute ← 代理端口存活。**拓扑只存在人脑里**，改一个服务影响谁全靠猜。

**④ 日志散落且会爆炸**
launchd **不提供日志轮转**。本机曾出现僵尸服务在 KeepAlive 下崩溃循环，把日志刷到 **1.3GB**。日志分布在 `~/Library/Logs/`、Docker logs、各服务目录，没有统一入口。

**⑤ 配置散在 5 种格式**
JSON / SQLite / YAML / `.env` / plist。改之前必须手动备份，回滚靠"我记得上次改了啥"。

**⑥ 环境级问题伪装成服务故障**（最阴险的一类）
- macOS **Maintenance Sleep**：一天睡 324 次，每次 500–930 秒，插电 + 有 NoDisplaySleepAssertion **都拦不住**。表现为"长请求必超时、短请求正常"，极易误判为供应商挂了
- **swap 84%（6.73G/8G）** 导致 load average 飙到 9.6 而 CPU 只有 4.3%——机器"看起来很忙"其实在等 I/O
- 端口冲突（7000 被 macOS ControlCenter AirPlay 占用）

---

## 二、产品定位与竞品

### 2.1 定位

**不是** Docker Desktop / Portainer（只管容器）
**不是** LaunchControl（只管 launchd，不懂服务语义）
**不是** Homepage / Dashy / Homer（只有导航，没有控制）
**是**：**面向自托管 AI 服务的语义级控制中心**——懂每个服务的"脾气"。

### 2.2 竞品对照

| 产品 | 覆盖 | 缺失（= 我们的机会） |
|---|---|---|
| LaunchControl | launchd 全功能 | 不管 Docker/App；无健康语义；无 AI 服务知识 |
| Docker Desktop / OrbStack | 容器 | 不管非容器服务；重 |
| Homepage / Dashy | 导航 + 基础探活 | **只读**，不能启停；无排障 |
| 各家自带 Web UI | 单服务 | 要记一堆端口；无全局视图 |
| Coolify / Dockge | 服务器/栈编排 | 面向部署而非本机日常运维 |

### 2.3 差异化三支柱

1. **语义级健康探针（L1→L2→L3）** — 判据只有一条标准：**真的发出去一条请求并拿到正确回复**
2. **依赖拓扑 + 影响面预警** — 停 A 之前告诉你"会连累 B、C"
3. **Playbook：把踩坑经验变成可执行诊断** — 检测到症状 → 匹配根因 → 一键修复（见 §5）

---

## 三、用户故事

| # | As a... | I want to... | So that... |
|---|---|---|---|
| 1 | 开发者 | 一打开电脑就看到所有 AI 服务的状态总览 | 不用逐个 `curl` 确认谁还活着 |
| 2 | 开发者 | 点一下就能启/停任意服务（不管它是 launchd 还是 Docker 还是脚本） | 不用记 6 套命令 |
| 3 | 开发者 | 看到"真能用"而不只是"端口通" | 不再被 `is_active=1` 骗 |
| 4 | 开发者 | 停服务前看到它会影响谁 | 避免误停 SearXNG 导致 Odysseus 搜索全挂 |
| 5 | 开发者 | 在一个地方看所有服务的日志，带关键字高亮和轮转保护 | 不再被 1.3GB 日志文件偷袭 |
| 6 | 开发者 | 改配置前一键快照、出事一键回滚 | 不再手动 `cp xxx.bak-<原因>-<时间戳>` |
| 7 | 开发者 | 服务挂了时，客户端直接告诉我"根因是 XX，点这里修" | 不用重翻排障笔记 |
| 8 | AI 工程师 | 服务升级前做一次全量快照 | 升级弄坏配置时能回到上一个已知良好状态 |
| 9 | 开发者 | 知道"机器在睡觉"而不是"供应商挂了" | 不再做无谓的配置改动 |
| 10 | 开发者 | 新装一个服务时，用一份 YAML 描述它就接入面板 | 不用改客户端代码 |

---

## 四、信息架构（IA）

```
LocalServiceHub
├── 🖥  Dashboard（主面板）
│   ├── 全局状态条：N 在线 / M 异常 / K 未启动 · 内存压力 · 代理状态 · 睡眠状态
│   ├── 服务卡片网格（按 Category 分组）
│   │   └── 卡片：状态灯 · 名称 · 端口 · 主操作(启/停) · 探针结果 · 直达按钮
│   └── 近期告警 / 环境提示
│
├── 🕸  Topology（依赖拓扑图）
│   └── 有向图：谁依赖谁 · 故障传播链 · 点击节点跳转详情
│
├── 🔍 Service Detail（服务详情）
│   ├── Overview：状态 · 版本 · PID · 运行时长 · 资源占用
│   ├── Probes：L1/L2/L3 各级探针结果与耗时
│   ├── Logs：实时 tail · 关键字高亮 · 级别过滤 · 检索 · 轮转状态
│   ├── Config：配置文件定位 · 内联查看 · 快照/回滚 · 差异对比
│   └── Playbook：匹配到的症状与修复建议
│
├── 🩺 Doctor（环境体检）
│   ├── 电源与睡眠（pmset / Maintenance Sleep 次数）
│   ├── 内存与 swap（swapusage / memory_pressure）
│   ├── 端口冲突检测
│   ├── 代理连通性（7890 是否活着 + 出网实测）
│   └── 磁盘（日志体积 Top 10）
│
├── 📦 Registry（服务注册表）
│   ├── 内置服务清单
│   ├── 自定义服务（导入 YAML / 编辑）
│   └── 自动发现结果（未纳管的候选服务）
│
└── ⚙️  Settings
    ├── 开机自启 · 托盘显示 · 探针频率
    ├── 快照存储位置与保留策略
    └── 危险操作二次确认开关
```

---

## 五、核心功能设计

### 5.1 服务注册表（Service Manifest）— 系统的地基

每个服务用一份声明式 YAML 描述，**不改客户端代码即可接入新服务**：

```yaml
id: odysseus
name: Odysseus
category: ai-workspace          # inference | rag | gateway | workspace | infra
icon: ./icons/odysseus.svg
home: ~/Downloads/about-jindy/odysseus

# —— 发现 ——
detect:
  ports: [7001]
  process: 'uvicorn|agent_loop'
  launchd: []                    # 若由 launchd 托管

# —— 生命周期 ——
supervisor:
  kind: script                   # launchd | docker | app | script | pty
  start:   { cwd: '${home}', cmd: './start.sh start',  detach: setsid }
  stop:    { cwd: '${home}', cmd: './start.sh stop' }
  restart: { cwd: '${home}', cmd: './start.sh stop && ./start.sh start' }
  status:  { cwd: '${home}', cmd: './start.sh status' }
  note: '必须在用户 session 内启动；nohup 会被会话回收'

# —— 三级健康探针 ——
health:
  l1: { type: tcp,  port: 7001, timeout: 2000 }
  l2: { type: http, url: 'http://127.0.0.1:7001/api/health', expect: 200, timeout: 5000 }
  l3:
    - id: models-real-count
      desc: '/api/models 的 models=0 是假象，必须穿透查 model-endpoints'
      script: probes/odysseus-models.mjs
      expect: 'json.models.length > 0'

# —— 依赖 ——
depends_on: [chromadb, searxng, ollama]
provides: [ai-workspace-api]

# —— 配置与快照 ——
config:
  files: ['${home}/data/.env']
  sqlite: []
  plist: []

# —— 日志 ——
logs:
  - { kind: file,   path: '${home}/logs/odysseus.log', rotate: { size: 20MB, keep: 3 } }
  - { kind: docker, container: odysseus-searxng }

# —— 排障剧本（杀手锏，见 §5.5）——
playbooks: [searxng-no-result, embedding-lane-missing, host-frozen]
```

**四种 Supervisor 抽象**

| kind | 启动 | 停止 | 状态 | 备注 |
|---|---|---|---|---|
| `launchd` | `launchctl kickstart -k gui/$UID/<label>` | `launchctl kill TERM` | `launchctl print` | ⚠️ 只用 kickstart，不 bootstrap（见风险 §8） |
| `docker` | `docker start <c>` | `docker stop <c>` | `docker inspect` | 需 Docker Desktop 在跑 |
| `app` | `open -a <App>` | `osascript quit` | 进程探测 | 关闭需用户确认 |
| `script` | `setsid` 脱离进程组 | 对应脚本 | 端口+进程 | 必须 `start_new_session`，不能 `nohup &` |
| `pty` | 分配伪终端后执行 | kill pgroup | 端口 | **dsh 专用**：dsh-tui 校验 TTY |

### 5.2 三级健康探针

| 级别 | 判据 | 回答的问题 | 示例 |
|---|---|---|---|
| **L1 存活** | TCP 端口可连 | 进程还在吗 | `nc -z 127.0.0.1 7001` |
| **L2 就绪** | HTTP 状态码/响应体 | 接口答得上来吗 | `/api/health` = 200 |
| **L3 语义** | 真实请求拿到正确结果 | **真的能用吗** | OmniRoute：挑 2 个模型各发一条请求看是否返回内容；Odysseus：穿透查 model-endpoints 数 |

> **设计原则（来自血泪教训）：L1/L2 绿灯但 L3 红灯 = 服务在"假活"。UI 必须用琥珀色明确标注，不能显示绿色。**
> 判据只有一条：**真的发出去一条请求并拿到回复**。配置状态、CLI 列表、`is_active` 全都不作数。

支持的 L3 探针类型：`http_json`（断言 JSON 路径）、`script`（自定义 node/py 脚本）、`llm_echo`（发一条 "reply PONG" 并校验响应）。

### 5.3 依赖关系与影响面

- 从 `depends_on` 构建有向图，拓扑排序决定**启停顺序**（启动自底向上、停止自顶向下）
- 停止服务前弹出影响面提示："停止 SearXNG 将影响 **Odysseus**（联网搜索不可用）"
- 故障传播：父服务红灯时，子服务标注"受连累"而非独立故障，避免误报轰炸

### 5.4 统一日志中心

- 多源聚合：`file tail` / `docker logs -f` / `launchd stdout`
- **轮转保护**：内置 20MB 触发、保留 3 代、**copytruncate**（`cp f f.1 && : > f`，不能用 `mv`——launchd 持有 fd 会导致轮转失效）
- 锁必须带 PID 并可回收陈旧锁（否则 SIGKILL 后锁残留，轮转永久静默失效）
- 关键字高亮 + 级别着色 + 全文检索 + 已知无害告警白名单（如 `wikipedia: 503`、`capture() takes 1 positional argument`）

### 5.5 Playbook —— 核心护城河

把排障知识结构化成"症状 → 根因 → 修复"的可执行剧本：

```yaml
id: searxng-no-result
service: odysseus
trigger:
  probe: searxng-results-count
  when: 'results == 0'
title: SearXNG 搜不到结果
symptom: 搜索返回 Naver 房产、日本词典页等本地化垃圾结果
root_cause: |
  SearXNG 的 bing 引擎按 searxng_locale 生成 mkt 参数。
  locale 为 all/空时不传 mkt，Bing 按出口 IP 猜地区 → 返回本地化 SERP。
diagnose:
  - { cmd: "grep 'default_lang' ${home}/data/searxng/settings.yml", expect: 'en-US' }
fix:
  confirm: true                          # 危险操作二次确认
  backup: ['${home}/data/searxng/settings.yml']
  steps:
    - { type: edit, file: '${home}/data/searxng/settings.yml', set: 'search.default_lang: en-US' }
    - { type: exec, cmd: 'docker restart odysseus-searxng' }
  verify: { probe: searxng-results-count, expect: 'results > 10' }
```

**首期内置 Playbook（直接来自真实踩坑记录）**

| Playbook | 触发 | 一键修复动作 |
|---|---|---|
| `omniroute-ghost-proxy` | 供应商批量 `network_error` 且 `proxy_enabled=1` | 备份 SQLite → 批量关代理 → 重启服务 |
| `omniroute-testall-pollution` | `last_error` 含 "test not supported" | 清理被污染的 `test_status` |
| `searxng-no-result` | 搜索结果异常 / 条数骤降 | 设 `default_lang: en-US` → 重启容器 |
| `odysseus-embedding-lane` | `No embedding lanes available` | 补 `.env` 的 EMBEDDING_URL/MODEL |
| `openclaw-version-skew` | `Unrecognized key` 且 CLI 拒绝启动 | 备份 → 删除 `meta.migrations` → 提示升级 |
| `openclaw-plugin-corrupt` | `plugin verification failed` | `plugins install --force` → `kickstart -k` |
| `host-frozen` | 日志出现 `host timing gap` | 提示 Maintenance Sleep → 引导 `caffeinate` / pmset（需 sudo，给命令让用户跑） |
| `log-explosion` | 单文件 > 20MB | 立即 copytruncate + 定位崩溃循环源 |
| `dsh-duplicate-loader` | `duplicate loader entry id` | 定位冲突 bundle → 提示升级对应插件 |
| `port-occupied` | 启动失败且端口被占 | 显示占用进程 → 建议换端口 |

### 5.6 环境体检（Doctor）

| 检查项 | 命令/来源 | 告警条件 | 建议 |
|---|---|---|---|
| Maintenance Sleep | `pmset -g log \| grep -c Maintenance` | 24h 内 > 5 次 | 引导跑 `pmset` 脚本（sudo，给命令） |
| 防睡眠断言 | `pmset -g assertions` | 无 `PreventSystemSleep` | 建议服务 wrapper 加 `caffeinate -ims` |
| 内存压力 | `memory_pressure` / `sysctl vm.swapusage` | free% < 20% | 列出内存占用 Top 进程 |
| **假忙识别** | load avg vs CPU 合计 | load 高但 CPU 低 | 提示"是 I/O / swap 等待，不是算力不足"，别去换供应商 |
| 代理存活 | 请求 `127.0.0.1:7890` | 不通 | 高亮：一批供应商会挂 |
| 端口冲突 | 全端口扫描 | 注册表端口被非预期进程占用 | 显示占用者 |
| 日志体积 | 扫描注册表日志路径 | > 20MB | 一键轮转 |
| 磁盘 | `df -h` | 剩余 < 10% | 清理建议 |

---

## 六、技术架构

### 6.1 选型：Tauri 2 + React + TypeScript

| 维度 | Tauri 2 | Electron | 结论 |
|---|---|---|---|
| 常驻内存 | ~30–60MB | 200–400MB | **Tauri 胜**（本机 swap 已 84%，内存是硬约束） |
| 系统能力 | Rust 原生调 launchctl/libproc/pty | Node 侧需 node-pty 等 | 平手，Tauri 更干净 |
| 开发效率 | 需写 Rust 能力层 | 纯前端即可 | Electron 胜 |
| 打包体积 | ~10MB | ~150MB+ | Tauri 胜 |
| 用户技能匹配 | 需补 Rust | 契合前端背景 | Electron 胜 |

**结论：选 Tauri 2。** 理由是硬约束——这个 App 要**常驻托盘**，而本机内存已经在挨饿（swap 84%、load 虚高）。Electron 常驻 300MB 会加剧问题。
Rust 侧只做"能力层"（进程/launchd/日志/探针），**全部 UI 与业务逻辑留在 React/TS**，用户的强项仍然能发挥。

### 6.2 分层架构

```
┌──────────────────────────────────────────────────────────┐
│  前端层  React 18 + TypeScript + Zustand + Tailwind       │
│  ├─ Dashboard   ├─ Topology(React Flow)                  │
│  ├─ Detail      ├─ Doctor      ├─ Registry               │
│  └─ 设计语言：深色优先，状态灯语义化（绿/琥珀/红/灰）      │
└──────────────────── Tauri IPC (commands + events) ───────┘
┌──────────────────────────────────────────────────────────┐
│  Rust 能力层 (src-tauri)                                  │
│  ├─ registry   解析/校验 Service Manifest，热加载         │
│  ├─ supervisor launchd | docker | app | script | pty      │
│  │             （pty 用 portable-pty；script 用 setsid）   │
│  ├─ probe      L1 TCP → L2 HTTP → L3 语义(script sandbox)│
│  ├─ loghub     多源 tail + copytruncate 轮转 + 检索       │
│  ├─ envdoctor  pmset / swap / 端口 / 代理 / 磁盘          │
│  ├─ snapshot   配置文件快照(git-less 版本树) + 回滚        │
│  └─ playbook   症状匹配引擎 + 修复执行器（带 dry-run）     │
└──────────────────────────────────────────────────────────┘
        ↓ 读取                ↓ 执行              ↓ 监听
   ~/.lsh/services/*.yaml   launchctl/docker  日志文件/docker events
```

### 6.3 关键数据流

1. **状态刷新**：定时器（默认 5s）→ 并行跑所有服务的 L1 → 变化的跑 L2 → 有变更或每 60s 跑 L3
2. **事件推送**：Rust 侧状态变更 → Tauri event → 前端 Zustand store → UI + 托盘图标变色
3. **命令执行**：前端 invoke → Rust 侧**校验危险等级** → 需确认的走二次确认弹窗 → 执行（先备份）→ 返回结构化结果（stdout/stderr/exit code）

### 6.4 数据模型（核心实体）

```
Service        { id, name, category, icon, home, supervisor, health, depends_on,
                 config, logs, playbooks[] }
ServiceState   { id, status: running|stopped|degraded|unknown, pid, uptime,
                 probeResults: {l1,l2,l3}, cpu, mem, lastError }
Snapshot       { id, serviceId, timestamp, reason, files: [{path, contentHash, content}] }
PlaybookRun    { id, playbookId, serviceId, timestamp, steps[], result, rollbackId }
EnvReport      { timestamp, checks: [{name, status, value, suggestion}] }
```

持久化：SQLite（`~/.lsh/lsh.db`）存状态历史、快照索引、Playbook 执行记录；Manifest 用 YAML 文件（可 git 版本化、可分享）。

---

## 七、交互与视觉

### 7.1 状态灯语义（严格区分）

| 灯 | 含义 | 判定 |
|---|---|---|
| 🟢 绿 | 健康 | L1+L2+L3 全通过 |
| 🟡 琥珀 | **假活**（降级） | L1/L2 通过但 **L3 失败** — 必须显眼，不能当健康 |
| 🔴 红 | 故障 | L1 或 L2 失败 |
| ⚪ 灰 | 未启动 | — |
| 🔵 蓝 | 受连累 | 自身正常但依赖故障 |

### 7.2 关键界面草图（描述）

**Dashboard**：顶部全局状态条（`7 在线 · 2 假活 · 1 故障 · 内存 62% · 代理 ✓`）；中部卡片网格按 category 分组（推理 / RAG / 网关 / 工作空间 / 基础设施）；底部"环境提示"条（如"过去 24h 系统睡眠 47 次，长请求可能超时"）。

**服务详情 - Probes**：三级探针竖排时间线，每级显示耗时、断言、原始响应片段。L3 失败时展开"为什么这很重要"说明。

**Topology**：力导向图，节点=服务，边=依赖。故障节点红色脉冲，受连累节点蓝色描边。悬停显示影响链。

### 7.3 托盘

- 图标随全局最差状态变色
- 菜单：服务快捷启停（前 5 个）· 打开面板 · 立即体检 · 全部停止 · 退出

---

## 八、风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| 1 | **macOS TCC 权限**：访问 `~/Library`、`~/Downloads` 需授权 | 读不到配置/日志 | App **不使用 App Sandbox**；首次访问触发系统授权弹窗；引导用户授予"完全磁盘访问"。**约束服务目录不要放 `~/Downloads` 根目录**（已有教训） |
| 2 | **`launchctl bootstrap` 受限** | 无法注册新服务 | 客户端**只 kickstart 已注册 job**，不 bootstrap。需注册时生成命令让用户自己在终端跑 |
| 3 | **子进程被会话回收** | 脚本启的服务活不过会话 | 必须 `setsid` / `start_new_session` 脱离进程组；`nohup &` 不够 |
| 4 | **pty 服务的 TTY 依赖**（dsh） | 启动即崩 | 用 `portable-pty` 分配真实伪终端；pty 句柄需在 Rust 侧长持有，不能随命令结束释放 |
| 5 | **服务升级破坏客户端假设** | 探针/配置路径失效 | Manifest 加 `version_range`；定期跑 drift 检测（探测失败时提示"可能已升级，请更新 manifest"） |
| 6 | **危险操作（改配置 / 停服务 / 改 pmset）** | 数据丢失、系统设置被改 | **所有写操作强制先快照**；`confirm: true` 的 Playbook 走二次确认并显示将要修改的 diff；sudo 操作**只给命令不代执行** |
| 7 | **日志轮转死锁** | 轮转静默失效 → 磁盘爆 | 锁带 PID + 存活校验，可回收陈旧锁 |
| 8 | **误判导致误操作** | 关掉正常服务 | 诊断结论必须给出**证据链**（命令 + 输出），不臆测；修前显示"影响面" |
| 9 | 探针本身有副作用 / 成本 | LLM 探针烧 token | L3 中 `llm_echo` 类探针默认低频（5min+）、可关闭、用最便宜模型 |

---

## 九、路线图

### V0.1 — MVP（核心闭环，约 2 周）
- [ ] 服务注册表加载（先内置本机 9 个服务的 manifest）
- [ ] 自动发现（端口扫描 + 进程匹配 + launchd/docker 枚举）
- [ ] 四种 supervisor 的启/停/重启
- [ ] L1/L2 探针 + 状态灯
- [ ] 依赖拓扑（静态渲染）
- [ ] 统一日志（file + docker，含 copytruncate 轮转）
- [ ] 托盘常驻 + Dashboard 卡片网格

### V0.2 — 语义化（差异化落地，约 2 周）
- [ ] L3 语义探针框架 + 各服务自定义探针
- [ ] 环境体检 Doctor（睡眠 / 内存 / 代理 / 端口 / 日志体积）
- [ ] 配置快照与回滚
- [ ] 依赖关系影响面预警（停止前确认）
- [ ] Playbook 引擎 + 首期 10 个剧本（**只读诊断，不自动修复**）

### V0.3 — 自动化（护城河，约 2 周）
- [ ] Playbook 一键修复（带 confirm + 备份 + 回滚）
- [ ] 自愈策略（可选自动执行低风险 Playbook）
- [ ] 用量与成本统计（按服务聚合 token / 请求数）
- [ ] Manifest 市场 / 导入导出
- [ ] 启停编排（"一键启动我的 AI 工作环境"）

### 后续考虑
- 多机 / 远程主机纳管（SSH 隧道）
- 服务健康历史趋势图
- 与 AnythingLLM / OpenClaw API 深度集成（不只是探活，还能看任务队列）

---

## 十、成功指标

| 指标 | 目标 |
|---|---|
| 日活 | 开机自启后每日至少打开 1 次 |
| 故障定位时间 | 从"感觉不对"到"知道根因" < 30s（现状：数分钟到数十分钟，翻笔记） |
| 假活识别率 | L3 探针覆盖 100% 的已知假活场景 |
| 常驻内存 | < 80MB |
| 冷启动 | < 1s |
| 误操作事故 | 0（靠快照 + 二次确认保证） |

---

## 附录 A：首期内置服务清单

| id | 名称 | 端口 | supervisor | 优先级 |
|---|---|---|---|---|
| `ollama` | Ollama | 11434 | app | P0 |
| `omniroute` | OmniRoute | 20128 | launchd | P0 |
| `openclaw` | OpenClaw Gateway | 18789 | launchd | P0 |
| `odysseus` | Odysseus | 7001 | script | P0 |
| `chromadb` | ChromaDB | 8100 | script | P0 |
| `searxng` | SearXNG | 8081 | docker | P0 |
| `anythingllm` | AnythingLLM | 3001 | app | P1 |
| `dsh` | DeepSeek Harness | 3080 | **pty** | P1 |
| `proxy` | ClashX（基础设施） | 7890 | app | P1 |

## 附录 B：名词表

- **假活（Zombie-Healthy）**：端口通、健康检查通过，但实际功能不可用
- **Playbook**：结构化的"症状 → 根因 → 修复"可执行剧本
- **Manifest**：描述一个服务的声明式 YAML
- **L1/L2/L3 探针**：存活 / 就绪 / 语义 三级健康判据
