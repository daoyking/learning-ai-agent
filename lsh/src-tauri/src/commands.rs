use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::exec;
use crate::model::{Action, ServiceManifest};
use crate::registry;
use crate::scanner::{self, PortEntry, SupervisionState};

/// 前端渲染一张服务卡片所需的全部信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub priority: String,
    pub tags: Vec<String>,
    pub supervisor_kind: String,
    /// manifest 里声明了多少个可执行动作（start/stop/restart/status/bootstrap…）
    pub actions: Vec<String>,
    pub depends_on: Vec<String>,
    pub provides: Vec<String>,
    /// manifest 里声明的主端口
    pub port: Option<u16>,
    /// 实际在监听的端口
    pub listening_port: Option<u16>,
    pub pid: Option<i32>,
    pub process: Option<String>,
    /// running | stopped | unknown
    pub status: String,
    /// 是否处于监管之下。与 status 正交：
    /// running + unsupervised = 现在能用，崩了没人拉起，UI 必须报琥珀而非绿。
    pub supervised: SupervisionState,
    /// 本次卡片合成耗时（ms）
    pub probe_ms: u64,
    /// 声明的端口被别的进程占了
    pub port_conflict: Option<PortConflict>,
    pub playbooks: Vec<String>,
    /// 声明了几个 L3 语义探针（UI 提示"语义探针待接入"）
    pub l3_count: usize,
    pub log_count: usize,
    /// L2 HTTP 探针结果（ok + status + ms）
    pub l2_status: Option<L2ProbeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L2ProbeStatus {
    pub ok: bool,
    pub status: u16,
    pub expect_status: u16,
    pub ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortConflict {
    pub port: u16,
    pub command: String,
    pub pid: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub services: Vec<ServiceCard>,
    pub ports: Vec<PortEntry>,
    pub scanned_at_ms: u64,
    pub elapsed_ms: u64,
    pub manifest_dirs: Vec<String>,
}

/// 预览一个动作「将要做什么」。不执行，只回显，并带上安全等级，
/// 让前端决定要不要弹二次确认。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionPreview {
    pub service_id: String,
    pub action: String,
    /// precondition 不满足时被改走的那个动作名（如 start → bootstrap）
    pub effective_action: String,
    /// none | confirm | sudo
    pub danger: String,
    pub requires_confirm: bool,
    pub sudo_required: bool,
    pub command: String,
    pub cwd: String,
    pub rerouted: Option<String>,
    pub note: Option<String>,
    /// none | setsid | pty
    pub wrap: String,
    /// 为什么要包这一层（UI 直接展示，避免"我明明写的是 A，你跑的却是 B"的困惑）
    pub wrap_reason: Option<String>,
    /// 包装后的完整 argv 回显，便于核对
    pub wrapped_command: String,
}

/// 真正执行一个动作后的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunActionResult {
    pub service_id: String,
    pub action: String,
    pub effective_action: String,
    pub executed: bool,
    pub danger: String,
    pub requires_confirm: bool,
    pub sudo_required: bool,
    pub command: String,
    pub cwd: String,
    pub rerouted: Option<String>,
    /// 短命令（stop/status/bootstrap）捕获到的输出
    pub output: Option<String>,
    /// 短命令的退出码（None = 未捕获到 / 长任务无退出码）
    pub exit_code: Option<i32>,
    /// 长任务（start/restart）后台拉起后的子进程 pid
    pub spawned_pid: Option<u32>,
    pub timed_out: bool,
    pub note: Option<String>,
    pub error: Option<String>,
    /// none | setsid | pty
    pub wrap: String,
    pub wrap_reason: Option<String>,
    pub wrapped_command: String,
}

/// 扫描本机端口，与 manifest 合并出服务卡片。
#[tauri::command]
pub fn scan_services() -> Result<ScanResult, String> {
    let started = std::time::Instant::now();

    let ports = scanner::scan_listening_ports()?;
    let manifests = registry::load_manifests()?;

    let services = manifests
        .iter()
        .map(|m| build_card(m, &ports))
        .collect::<Vec<_>>();

    let elapsed_ms = started.elapsed().as_millis() as u64;

    Ok(ScanResult {
        services,
        ports,
        scanned_at_ms: now_ms(),
        elapsed_ms,
        manifest_dirs: registry::manifest_dirs()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
    })
}

/// 只返回端口快照（供 Registry 页做自动发现：找出未纳管的监听端口）
#[tauri::command]
pub fn scan_ports() -> Result<Vec<PortEntry>, String> {
    scanner::scan_listening_ports()
}

/// 返回原始 manifest（供 Registry / 详情页查看）
#[tauri::command]
pub fn list_services() -> Result<Vec<ServiceManifest>, String> {
    registry::load_manifests()
}

/// 解析出「实际要执行的动作」：处理 precondition → fallback_action 路由，
/// 展开变量，合并环境变量。preview 与 run 共用，避免两处逻辑漂移。
struct ResolvedAction {
    effective: String,
    act: Action,
    cmd: String,
    cwd: String,
    env: HashMap<String, String>,
    rerouted: Option<String>,
    wrap: exec::Wrap,
    /// 给 UI 看的一句话解释：为什么要这么包装。
    wrap_reason: Option<String>,
}

fn resolve_action(service_id: &str, action: &str) -> Result<ResolvedAction, String> {
    let manifests = registry::load_manifests()?;
    let m = manifests
        .iter()
        .find(|m| m.id == service_id)
        .ok_or_else(|| format!("未找到服务 {service_id}"))?;

    let requested = m
        .supervisor
        .actions
        .get(action)
        .ok_or_else(|| format!("服务 {service_id} 未定义 {action} 动作"))?;

    let supervised = scanner::check_supervision(
        &m.supervisor.supervision.check,
        m.supervisor.label.as_deref(),
        m.supervisor.container.as_deref(),
        m.supervisor.supervision.expect.as_deref(),
    );

    // 前置条件不满足时改走 fallback，而不是回一个"启动失败"。
    // 二者对用户的含义完全不同：前者是"还没注册"，后者是"坏了"。
    let (effective, act, rerouted) = match (&requested.precondition, &requested.fallback_action) {
        (Some(cond), Some(fallback)) if !eval_precondition(cond, supervised) => {
            let fb = m
                .supervisor
                .actions
                .get(fallback)
                .ok_or_else(|| format!("前置条件不满足，但 fallback 动作 {fallback} 未定义"))?;
            (fallback.clone(), fb.clone(), Some(cond.clone()))
        }
        _ => (action.to_string(), requested.clone(), None),
    };

    let home = registry::expand(&m.home.clone().unwrap_or_default(), None);
    let cmd = registry::expand(act.cmd.as_deref().unwrap_or(""), Some(&home));
    let cwd = act
        .cwd
        .as_deref()
        .map(|c| registry::expand(c, Some(&home)))
        .unwrap_or_else(|| home.clone());

    let mut env = HashMap::new();
    for (k, v) in m.env.iter().chain(act.env.iter()) {
        env.insert(k.clone(), registry::expand(v, Some(&home)));
    }

    let (wrap, wrap_reason) = derive_wrap(m, &effective, &act);

    Ok(ResolvedAction {
        effective,
        act,
        cmd,
        cwd,
        env,
        rerouted,
        wrap,
        wrap_reason,
    })
}

/// 决定长任务要不要包一层、包哪一层。
///
/// 优先级：action 显式声明 > supervisor 推导。
///
/// 最关键的一条判据：**走 launchctl 的 action 一律不包 pty**。
/// dsh 的 plist 自己就写了 `script -q`，由 launchd 托管后 TTY 问题已经被
/// 系统解决；客户端再包一层反而会抢走终端、让 launchctl 拿不到干净的输出。
fn derive_wrap(
    m: &ServiceManifest,
    action_name: &str,
    act: &Action,
) -> (exec::Wrap, Option<String>) {
    let cmd = act.cmd.clone().unwrap_or_default();
    let via_launchd = cmd.contains("launchctl");

    // 最本质的判据：命令既然交给 launchd，TTY 与守护就都由 launchd/plist 负责。
    // 判据放在动作名之前，是因为 start 可能被 precondition 改道成 bootstrap
    // （dsh 现在就是这样：job 未加载 → 先 bootstrap 再 kickstart）——
    // 改道后动作名变了，但"走 launchctl"这件事没变。
    if via_launchd {
        return (
            exec::Wrap::None,
            if m.supervisor.kind == "pty" {
                Some("经 launchctl 托管，TTY 由 plist 自带的 script -q 负责，不重复包装".into())
            } else {
                None
            },
        );
    }

    // 短命令（stop/status）跑完就退，不存在"被会话回收"问题。
    if !matches!(action_name, "start" | "restart") {
        return (exec::Wrap::None, None);
    }

    if let Some(w) = act.wrap.as_deref() {
        return match w {
            "setsid" => (
                exec::Wrap::Setsid,
                Some("manifest 声明 setsid：脱离会话，客户端退出不回收".into()),
            ),
            "pty" => match &m.supervisor.pty {
                Some(p) => (
                    exec::Wrap::Pty {
                        log: registry::expand(p.log.as_deref().unwrap_or("/dev/null"), None),
                        rows: p.rows,
                        cols: p.cols,
                    },
                    Some("manifest 声明 pty：程序校验 isatty()，需伪终端".into()),
                ),
                None => (exec::Wrap::None, None),
            },
            _ => (exec::Wrap::None, None),
        };
    }

    // supervisor 级推导
    if m.supervisor.detach.as_deref() == Some("setsid") {
        return (
            exec::Wrap::Setsid,
            Some("supervisor.detach=setsid：常驻脚本需脱离客户端会话".into()),
        );
    }

    if m.supervisor.kind == "pty" {
        if let Some(p) = &m.supervisor.pty {
            return (
                exec::Wrap::Pty {
                    log: registry::expand(p.log.as_deref().unwrap_or("/dev/null"), None),
                    rows: p.rows,
                    cols: p.cols,
                },
                Some("supervisor.kind=pty：程序校验 isatty()，需自建伪终端".into()),
            );
        }
    }

    (exec::Wrap::None, None)
}

/// danger 判定：sudo 字段优先级最高（绝不代执行），其次看 action.danger。
fn effective_danger(act: &Action) -> String {
    if act.sudo {
        return "sudo".into();
    }
    act.danger.clone().unwrap_or_else(|| "none".into())
}

fn wrap_view(w: &exec::Wrap) -> String {
    match w {
        exec::Wrap::None => "none".into(),
        exec::Wrap::Setsid => "setsid".into(),
        exec::Wrap::Pty { .. } => "pty".into(),
    }
}

/// 把 argv 渲染成一行可读命令。仅用于展示，真正执行走 argv 数组，
/// 所以这里加引号只是为了好看，不承担防注入职责。
fn render_argv(shell: &str, cmd: &str, w: &exec::Wrap) -> String {
    let (prog, args) = exec::build_argv(shell, cmd, w);
    let mut parts = vec![prog];
    parts.extend(args);
    parts
        .iter()
        .map(|s| {
            if s.is_empty() || s.contains(' ') || s.contains('\'') || s.contains('"') {
                format!("'{}'", s.replace('\'', "'\\''"))
            } else {
                s.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_card(m: &ServiceManifest, ports: &[PortEntry]) -> ServiceCard {
    let started = std::time::Instant::now();

    let declared = m.detect.ports.first().copied();
    let mut listening_port = None;
    let mut pid = None;
    let mut process = None;
    let mut port_conflict = None;

    for candidate in &m.detect.ports {
        if let Some(entry) = ports.iter().find(|p| p.port == *candidate) {
            listening_port = Some(entry.port);
            pid = Some(entry.pid);
            process = Some(entry.command.clone());
            break;
        }
    }

    // 端口被占但进程不是我们认识的 → 记为冲突
    if listening_port.is_none() {
        if let Some(port) = declared {
            if let Some(owner) = scanner::who_owns(port) {
                port_conflict = Some(PortConflict {
                    port: owner.port,
                    command: owner.command.clone(),
                    pid: owner.pid,
                });
            }
        }
    }

    let status = if listening_port.is_some() {
        "running"
    } else if !m.detect.launchd.is_empty() || !m.detect.paths.is_empty() {
        // 有安装痕迹但没在跑
        "stopped"
    } else {
        "unknown"
    };

    // 监管判定是独立的第二维度：端口在 ≠ 有人盯着。
    // 本机实测 omniroute 就是端口在跑、launchd job 从未加载的孤儿进程。
    let supervised = scanner::check_supervision(
        &m.supervisor.supervision.check,
        m.supervisor.label.as_deref(),
        m.supervisor.container.as_deref(),
        m.supervisor.supervision.expect.as_deref(),
    );

    ServiceCard {
        id: m.id.clone(),
        name: m.name.clone(),
        description: m.description.clone(),
        category: m.category.clone(),
        priority: m.priority.clone(),
        tags: m.tags.clone(),
        supervisor_kind: m.supervisor.kind.clone(),
        actions: m.supervisor.actions.keys().cloned().collect(),
        depends_on: m.depends_on.clone(),
        provides: m.provides.clone(),
        port: declared,
        listening_port,
        pid,
        process,
        status: status.into(),
        supervised,
        probe_ms: started.elapsed().as_millis() as u64,
        port_conflict,
        playbooks: m.playbooks.clone(),
        l3_count: m.health.l3.len(),
        log_count: m.logs.len(),
        l2_status: None, // 启动时不运行 L2（仅在用户点击时运行）
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 预览：只展示将要执行的命令与安全等级，不真正运行。
#[tauri::command]
pub fn preview_action(service_id: String, action: String) -> Result<ActionPreview, String> {
    let r = resolve_action(&service_id, &action)?;
    let danger = effective_danger(&r.act);
    // 先算完再 move：struct literal 按字段顺序求值，
    // command: r.cmd 一旦 move，后面就借不到 r.cmd 了。
    let wrapped_command = render_argv(&r.act.shell, &r.cmd, &r.wrap);
    Ok(ActionPreview {
        service_id,
        action,
        effective_action: r.effective,
        danger: danger.clone(),
        requires_confirm: danger == "confirm",
        sudo_required: danger == "sudo",
        command: r.cmd,
        cwd: r.cwd,
        rerouted: r.rerouted,
        note: r.act.note,
        wrap: wrap_view(&r.wrap),
        wrap_reason: r.wrap_reason,
        wrapped_command,
    })
}

/// 真正执行。安全门：
///   danger == sudo      → 绝不代执行，只把命令交给用户手动跑
///   danger == confirm   → 必须 confirmed=true 才执行，否则只回预览
///   danger == none      → 直接执行（仍先回显命令，UI 可二次确认）
///
/// start/restart 视为长任务：后台拉起即返回 pid，不阻塞等待；
/// stop/status/bootstrap 视为短命令：限时等待并捕获输出。
#[tauri::command]
pub fn run_action(
    service_id: String,
    action: String,
    confirmed: bool,
) -> Result<RunActionResult, String> {
    let mut r = resolve_action(&service_id, &action)?;
    let danger = effective_danger(&r.act);

    // 包装视图必须在这里算好：下面 r 会被逐字段 move，届时再借用就晚了。
    let wrap_str = wrap_view(&r.wrap);
    let wrap_reason = r.wrap_reason.clone();
    let wrapped_command = render_argv(&r.act.shell, &r.cmd, &r.wrap);
    let timeout_ms = r.act.timeout_ms;

    // 先造一个"什么都不做"的基础结果，各分支只改自己关心的字段。
    // 这样新增字段时只有一处要改，不会漏掉某个分支。
    let mut out = RunActionResult {
        service_id,
        action: action.clone(),
        effective_action: r.effective.clone(),
        executed: false,
        danger: danger.clone(),
        requires_confirm: false,
        sudo_required: false,
        command: r.cmd.clone(),
        cwd: r.cwd.clone(),
        rerouted: r.rerouted.clone(),
        output: None,
        exit_code: None,
        spawned_pid: None,
        timed_out: false,
        note: r.act.note.clone(),
        error: None,
        wrap: wrap_str,
        wrap_reason,
        wrapped_command,
    };

    if danger == "sudo" {
        out.sudo_required = true;
        out.error = Some("该动作需要提权，客户端不代执行，请在终端手动运行".into());
        return Ok(out);
    }

    if danger == "confirm" && !confirmed {
        out.requires_confirm = true;
        return Ok(out);
    }

    // shell 形如 "/bin/zsh -lc" → 拆成程序 + 参数（-l -c）。
    // clone 成局部串再切，避免 borrow 一路借到 r 上、挡住后面修改 r.env。
    let shell = r.act.shell.clone();
    let parts: Vec<&str> = shell.split_whitespace().collect();
    let (prog, base_args) = parts
        .split_first()
        .ok_or_else(|| format!("action shell 为空: {shell}"))?;

    let is_long_running = matches!(action.as_str(), "start" | "restart");

    if is_long_running {
        // pty 包装的前置工作：script 不会自建目录，日志父目录不在就直接失败。
        let pty_cfg = match &r.wrap {
            exec::Wrap::Pty { log, rows, cols } => Some((log.clone(), *rows, *cols)),
            _ => None,
        };
        if let Some((log, rows, cols)) = pty_cfg {
            exec::ensure_parent_dir(&log)?;
            for (k, v) in exec::pty_env(rows, cols) {
                r.env.insert(k, v);
            }
        }

        match exec::spawn_detached(prog, base_args, &r.cmd, &r.cwd, &r.env, &r.wrap) {
            Ok(pid) => {
                out.executed = true;
                out.output = Some(format!(
                    "已在后台启动 (pid={pid})，请稍后重新扫描确认端口。"
                ));
                out.spawned_pid = Some(pid);
            }
            Err(e) => out.error = Some(e),
        }
    } else {
        match exec::run_blocking(prog, base_args, &r.cmd, &r.cwd, &r.env, timeout_ms) {
            Ok(o) => {
                out.executed = true;
                out.output = Some(o.combined);
                out.exit_code = Some(o.code);
                out.timed_out = o.timed_out;
                if o.timed_out {
                    out.error = Some(format!("命令在 {timeout_ms}ms 内未结束，已终止"));
                }
            }
            Err(e) => out.error = Some(e),
        }
    }

    Ok(out)
}

/// V0.1 的极简前置条件求值：只认 `supervised == true|false` 这一种形态。
///
/// 刻意不做通用表达式解析 —— 一旦放开就是任意代码执行的口子。
/// 等 Playbook DSL 的 expr 白名单解析器落地后（V0.2），这里换成调用它。
fn eval_precondition(cond: &str, supervised: SupervisionState) -> bool {
    let c: String = cond.chars().filter(|ch| !ch.is_whitespace()).collect();
    let want = match c.as_str() {
        "supervised==true" => true,
        "supervised==false" => false,
        _ => return true, // 认不出来的条件一律放行，别把用户挡在门外
    };
    (supervised == SupervisionState::Supervised) == want
}

// ───────────────────────────── Playbook 引擎（V0.2：加载 / 匹配 / 只读诊断） ─────────────────────────────

#[tauri::command]
pub fn list_playbooks() -> Result<Vec<crate::pb::PlaybookSummary>, String> {
    crate::pb::list_playbooks_meta()
}

#[tauri::command]
pub fn match_playbooks(ctx: crate::pb::MatchContext) -> Result<Vec<crate::pb::MatchedPlaybook>, String> {
    crate::pb::match_playbooks(&ctx)
}

#[tauri::command]
pub fn diagnose_playbook(id: String) -> Result<crate::pb::DiagnoseResult, String> {
    let pb = crate::pb::get_playbook(&id)?;
    crate::pb::diagnose(&pb)
}

#[tauri::command]
pub fn run_probes() -> Result<Vec<crate::pb::ProbeRun>, String> {
    crate::pb::run_all_probes()
}

/// 运行 L2 HTTP 探针，返回单个服务的 L2 健康结果。
#[tauri::command]
pub fn run_l2_probe(service_id: String) -> Result<serde_json::Value, String> {
    let manifests = crate::registry::load_manifests()?;
    let m = manifests
        .iter()
        .find(|m| m.id == service_id)
        .ok_or_else(|| format!("找不到服务 {service_id}"))?;
    crate::pb::run_l2_probe(&service_id, m)
}

// ───────────────────────────── 日志中心（V0.2：聚合尾部 + 旋转） ─────────────────────────────

#[tauri::command]
pub fn list_log_sources(service_id: String) -> Result<Vec<crate::logs::LogSourceView>, String> {
    crate::logs::list_log_sources(&service_id)
}

#[tauri::command]
pub fn tail_logs(service_id: String, lines: u32) -> Result<Vec<crate::logs::LogTail>, String> {
    crate::logs::tail_logs(&service_id, lines)
}

#[tauri::command]
pub fn rotate_log(service_id: String, source_id: String) -> Result<String, String> {
    crate::logs::rotate_log(&service_id, source_id)
}

// ───────────────────────────── 环境体检 Doctor ─────────────────────────────

#[tauri::command]
pub fn run_doctor() -> Result<Vec<crate::doctor::DoctorCheck>, String> {
    crate::doctor::run_doctor()
}

// ───────────────────────────── V0.3 一键修复 ─────────────────────────────

#[tauri::command]
pub fn apply_fix(id: String, confirmed: bool) -> Result<crate::pb::FixApplyResult, String> {
    let pb = crate::pb::get_playbook(&id)?;
    crate::pb::apply_fix(&pb, confirmed)
}

/// 把当前健康结论同步到托盘：换图标 + 改 tooltip。
///
/// 常驻后台时菜单栏图标就是全部信息 —— 不用点开窗口也能看出
/// 是有服务挂了（红）、有隐患（琥珀）、还是一切正常（绿）。
///
/// 图标用 include_bytes! 编译进二进制，不依赖运行时资源路径，
/// 打包后也不会找不到文件。
#[tauri::command]
pub fn update_tray_status(
    app: tauri::AppHandle,
    status: String,
    level: Option<String>,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("lsh-tray") else {
        return Ok(());
    };

    tray.set_tooltip(Some(status))
        .map_err(|e| format!("更新托盘状态失败: {e}"))?;

    let level = level.unwrap_or_else(|| "ok".into());
    let bytes: &[u8] = match level.as_str() {
        "fail" | "error" | "down" => include_bytes!("../icons/tray-fail.png"),
        "warn" | "warning" => include_bytes!("../icons/tray-warn.png"),
        _ => include_bytes!("../icons/tray-ok.png"),
    };

    // set_icon 失败不该让整个状态同步挂掉：tooltip 已经更新，
    // 图标退化为不变即可，用户依然能从文字看到结论。
    if let Ok(img) = tauri::image::Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(img));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precondition_routes_unsupervised_to_fallback() {
        // omniroute 的真实处境：端口在跑，但 launchd job 从未加载。
        // 此时 start 的前置条件 supervised == true 不成立，必须改走 bootstrap。
        assert!(!eval_precondition(
            "supervised == true",
            SupervisionState::Unsupervised
        ));
        assert!(eval_precondition(
            "supervised == true",
            SupervisionState::Supervised
        ));
        assert!(eval_precondition(
            "supervised == false",
            SupervisionState::Unsupervised
        ));
    }

    #[test]
    fn unknown_precondition_fails_open() {
        // 认不出来的条件一律放行：宁可多执行一次，也不要把用户挡在门外
        assert!(eval_precondition(
            "something_else == 1",
            SupervisionState::Unsupervised
        ));
        assert!(eval_precondition(
            "supervised >= 2",
            SupervisionState::Supervised
        ));
    }

    #[test]
    fn danger_priority_sudo_over_confirm() {
        let mut a = Action {
            cmd: Some("x".into()),
            cwd: None,
            shell: "/bin/zsh -lc".into(),
            timeout_ms: 1000,
            env: HashMap::new(),
            danger: Some("confirm".into()),
            sudo: true,
            note: None,
            precondition: None,
            fallback_action: None,
            wrap: None,
        };
        assert_eq!(effective_danger(&a), "sudo");

        a.sudo = false;
        assert_eq!(effective_danger(&a), "confirm");

        a.danger = None;
        assert_eq!(effective_danger(&a), "none");
    }

    #[test]
    fn confirm_gated_stop_does_not_execute_without_confirm() {
        // ollama 的 stop 是 danger: confirm。未确认时绝不能真的把服务停掉。
        // 这是产品安全门的核心断言。
        let r = run_action("ollama".into(), "stop".into(), false).unwrap();
        assert!(!r.executed, "未确认时绝不能执行 stop");
        assert!(r.requires_confirm);
        assert!(!r.sudo_required);
        assert!(r.error.is_none());
    }

    #[test]
    fn status_action_executes_and_captures_output() {
        // chromadb 的 status 是只读 pgrep 判断，安全可执行。
        // 无论服务在不在，都应 executed=true 且拿到输出（证明真实执行链路通了）。
        let r = run_action("chromadb".into(), "status".into(), false).unwrap();
        assert!(r.executed, "status 应已执行: {:?}", r.error);
        assert!(r.output.is_some(), "应捕获到输出");
        assert!(r.exit_code.is_some(), "应拿到退出码");
        assert!(!r.sudo_required);
    }

    /// 五种 supervisor 的包装策略必须各就各位，这是"能否真正拉起服务"的分水岭。
    fn wrap_of(service: &str, action: &str) -> String {
        let r = resolve_action(service, action)
            .unwrap_or_else(|e| panic!("{service}/{action} 解析失败: {e}"));
        wrap_view(&r.wrap)
    }

    #[test]
    fn script_services_start_with_setsid() {
        // odysseus / chromadb 是 start.sh 拉起的常驻进程。
        // 不 setsid 就会留在客户端会话里，客户端一退服务跟着没。
        for id in ["odysseus", "chromadb"] {
            assert_eq!(wrap_of(id, "start"), "setsid", "{id} 的 start 必须包 setsid");
        }
    }

    #[test]
    fn launchctl_actions_are_never_pty_wrapped() {
        // dsh 的 start 走 launchctl，而它的 plist 自己就写了 script -q。
        // 客户端再包一层 pty 会抢走终端，导致 launchctl 拿不到干净输出。
        assert_eq!(wrap_of("dsh", "start"), "none");
        let r = resolve_action("dsh", "start").unwrap();
        let reason = r.wrap_reason.unwrap_or_default();
        assert!(
            reason.contains("launchctl"),
            "理由应说明 TTY 由 plist 负责，实际: {reason}"
        );
    }

    #[test]
    fn short_actions_are_never_wrapped() {
        // stop/status/bootstrap 跑完就退，不存在"被会话回收"的问题，别多此一举。
        assert_eq!(wrap_of("odysseus", "status"), "none");
        assert_eq!(wrap_of("chromadb", "stop"), "none");
    }

    #[test]
    fn app_launchd_docker_need_no_wrap() {
        // 这三类要么由系统 API 接管（app），要么由守护进程接管（launchd/docker），
        // 客户端只负责发命令，不需要也不应该自己包进程。
        for id in ["ollama", "searxng", "omniroute"] {
            assert_eq!(wrap_of(id, "start"), "none", "{id} 由外部守护接管，无需包装");
        }
    }

    #[test]
    fn wrapped_command_is_rendered_for_ui() {
        // 用户必须能看到"实际执行的不只是你写的那行"，否则无法信任客户端。
        let p = preview_action("odysseus".into(), "start".into()).unwrap();
        assert_eq!(p.wrap, "setsid");
        assert!(
            p.wrapped_command.starts_with("perl -MPOSIX"),
            "包装后的命令应以 perl 开头: {}",
            p.wrapped_command
        );
        assert!(
            p.wrapped_command.contains("./start.sh"),
            "目标命令必须原样出现在末尾: {}",
            p.wrapped_command
        );
    }

    #[test]
    fn preview_reports_danger_without_executing() {
        let p = preview_action("ollama".into(), "stop".into()).unwrap();
        assert_eq!(p.action, "stop");
        assert_eq!(p.danger, "confirm");
        assert!(p.requires_confirm);
        assert!(!p.command.is_empty());
    }
}
