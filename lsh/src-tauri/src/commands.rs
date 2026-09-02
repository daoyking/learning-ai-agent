use std::collections::HashMap;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

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

    Ok(ResolvedAction {
        effective,
        act,
        cmd,
        cwd,
        env,
        rerouted,
    })
}

/// danger 判定：sudo 字段优先级最高（绝不代执行），其次看 action.danger。
fn effective_danger(act: &Action) -> String {
    if act.sudo {
        return "sudo".into();
    }
    act.danger.clone().unwrap_or_else(|| "none".into())
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
    let r = resolve_action(&service_id, &action)?;
    let danger = effective_danger(&r.act);

    if danger == "sudo" {
        return Ok(RunActionResult {
            service_id,
            action,
            effective_action: r.effective.clone(),
            executed: false,
            danger,
            requires_confirm: false,
            sudo_required: true,
            command: r.cmd,
            cwd: r.cwd,
            rerouted: r.rerouted,
            output: None,
            exit_code: None,
            spawned_pid: None,
            timed_out: false,
            note: r.act.note,
            error: Some("该动作需要提权，客户端不代执行，请在终端手动运行".into()),
        });
    }

    if danger == "confirm" && !confirmed {
        return Ok(RunActionResult {
            service_id,
            action,
            effective_action: r.effective.clone(),
            executed: false,
            danger,
            requires_confirm: true,
            sudo_required: false,
            command: r.cmd,
            cwd: r.cwd,
            rerouted: r.rerouted,
            output: None,
            exit_code: None,
            spawned_pid: None,
            timed_out: false,
            note: r.act.note,
            error: None,
        });
    }

    // shell 形如 "/bin/zsh -lc" → 拆成程序 + 参数（-l -c）
    let parts: Vec<&str> = r.act.shell.split_whitespace().collect();
    let (prog, base_args) = parts
        .split_first()
        .ok_or_else(|| format!("action shell 为空: {}", r.act.shell))?;

    let is_long_running = matches!(action.as_str(), "start" | "restart");

    if is_long_running {
        match spawn_detached(prog, base_args, &r.cmd, &r.cwd, &r.env) {
            Ok(pid) => Ok(RunActionResult {
                service_id,
                action,
                effective_action: r.effective,
                executed: true,
                danger,
                requires_confirm: false,
                sudo_required: false,
                command: r.cmd,
                cwd: r.cwd,
                rerouted: r.rerouted,
                output: Some(format!(
                    "已在后台启动 (pid={pid})，请稍后重新扫描确认端口。"
                )),
                exit_code: None,
                spawned_pid: Some(pid),
                timed_out: false,
                note: r.act.note,
                error: None,
            }),
            Err(e) => Ok(RunActionResult {
                service_id,
                action,
                effective_action: r.effective,
                executed: false,
                danger,
                requires_confirm: false,
                sudo_required: false,
                command: r.cmd,
                cwd: r.cwd,
                rerouted: r.rerouted,
                output: None,
                exit_code: None,
                spawned_pid: None,
                timed_out: false,
                note: r.act.note,
                error: Some(e),
            }),
        }
    } else {
        let outcome = run_blocking(prog, base_args, &r.cmd, &r.cwd, &r.env, r.act.timeout_ms);
        match outcome {
            Ok(o) => Ok(RunActionResult {
                service_id,
                action,
                effective_action: r.effective,
                executed: true,
                danger,
                requires_confirm: false,
                sudo_required: false,
                command: r.cmd,
                cwd: r.cwd,
                rerouted: r.rerouted,
                output: Some(o.combined),
                exit_code: Some(o.code),
                spawned_pid: None,
                timed_out: o.timed_out,
                note: r.act.note,
                error: if o.timed_out {
                    Some(format!("命令在 {}ms 内未结束，已终止", r.act.timeout_ms))
                } else {
                    None
                },
            }),
            Err(e) => Ok(RunActionResult {
                service_id,
                action,
                effective_action: r.effective,
                executed: false,
                danger,
                requires_confirm: false,
                sudo_required: false,
                command: r.cmd,
                cwd: r.cwd,
                rerouted: r.rerouted,
                output: None,
                exit_code: None,
                spawned_pid: None,
                timed_out: false,
                note: r.act.note,
                error: Some(e),
            }),
        }
    }
}

/// 后台拉起一个长任务（start/restart）。脱离 Tauri 进程组，
/// stdio 全部丢弃，立即返回子进程 pid，不阻塞等待。
///
/// 注意：macOS 没有 setsid 二进制，真正的 TTY 解耦由 manifest 的
/// `script -q` / `perl POSIX::setsid` 包装负责；这里只保证 Rust 侧不卡住。
fn spawn_detached(
    prog: &str,
    base_args: &[&str],
    cmd: &str,
    cwd: &str,
    env: &HashMap<String, String>,
) -> Result<u32, String> {
    let mut command = Command::new(prog);
    command
        .args(base_args)
        .arg(cmd)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.clone(), v.clone())))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // 新进程组，尽量与 Tauri 进程解耦
    command.process_group(0);

    let child = command
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(child.id())
}

/// 限时执行一个短命令（stop/status/bootstrap），捕获合并后的 stdout+stderr。
fn run_blocking(
    prog: &str,
    base_args: &[&str],
    cmd: &str,
    cwd: &str,
    env: &HashMap<String, String>,
    timeout_ms: u64,
) -> Result<BlockOutcome, String> {
    let mut command = Command::new(prog);
    command
        .args(base_args)
        .arg(cmd)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.clone(), v.clone())))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("执行失败: {e}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1000));
    let mut timed_out = false;
    loop {
        match child
            .try_wait()
            .map_err(|e| format!("等待子进程失败: {e}"))?
        {
            Some(_) => break,
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("读取命令输出失败: {e}"))?;
    let code = out.status.code().unwrap_or(-1);
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(BlockOutcome {
        code,
        combined,
        timed_out,
    })
}

struct BlockOutcome {
    code: i32,
    combined: String,
    timed_out: bool,
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

    #[test]
    fn preview_reports_danger_without_executing() {
        let p = preview_action("ollama".into(), "stop".into()).unwrap();
        assert_eq!(p.action, "stop");
        assert_eq!(p.danger, "confirm");
        assert!(p.requires_confirm);
        assert!(!p.command.is_empty());
    }
}
