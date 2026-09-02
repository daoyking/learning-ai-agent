use serde::{Deserialize, Serialize};

use crate::model::ServiceManifest;
use crate::registry;
use crate::scanner::{self, PortEntry, SupervisionState};

/// 前端渲染一张服务卡片所需的全部信息。
/// V0.1 只做 L1（端口存活），L2/L3 在 V0.2 接入。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub priority: String,
    pub tags: Vec<String>,
    pub supervisor_kind: String,
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

/// 占位：V0.2 才真正执行启停。
/// V0.1 只回显将要执行的命令（dry-run）—— 在快照与二次确认做好之前，
/// 绝不让 UI 按钮真的去动用户的服务。
#[tauri::command]
pub fn preview_action(service_id: String, action: String) -> Result<String, String> {
    let manifests = registry::load_manifests()?;
    let m = manifests
        .iter()
        .find(|m| m.id == service_id)
        .ok_or_else(|| format!("未找到服务 {service_id}"))?;

    let requested = m
        .supervisor
        .actions
        .get(&action)
        .ok_or_else(|| format!("服务 {service_id} 未定义 {action} 动作"))?;

    let supervised = scanner::check_supervision(
        &m.supervisor.supervision.check,
        m.supervisor.label.as_deref(),
        m.supervisor.container.as_deref(),
        m.supervisor.supervision.expect.as_deref(),
    );

    // 前置条件不满足时改走 fallback，而不是回一个"启动失败"。
    // 二者对用户的含义完全不同：前者是"还没注册"，后者是"坏了"。
    let (effective_name, act, rerouted) = match (&requested.precondition, &requested.fallback_action) {
        (Some(cond), Some(fallback)) if !eval_precondition(cond, supervised) => {
            let fb = m
                .supervisor
                .actions
                .get(fallback)
                .ok_or_else(|| format!("前置条件不满足，但 fallback 动作 {fallback} 未定义"))?;
            (fallback.as_str(), fb, Some(cond.as_str()))
        }
        _ => (action.as_str(), requested, None),
    };

    let home_raw = m.home.clone().unwrap_or_default();
    let home = registry::expand(&home_raw, None);

    let cmd = registry::expand(act.cmd.as_deref().unwrap_or(""), Some(&home));
    let cwd = act
        .cwd
        .as_deref()
        .map(|c| registry::expand(c, Some(&home)))
        .unwrap_or_else(|| home.clone());

    let mut out = String::from("[dry-run] 不会真的执行\n");
    if let Some(cond) = rerouted {
        out.push_str(&format!(
            "⚠ 前置条件不满足：{cond}（当前 supervised = {supervised:?}）\n"
        ));
        out.push_str(&format!("  已改用 {effective_name} 代替 {action}\n"));
    }
    if let Some(note) = &act.note {
        out.push_str(&format!("说明：{note}\n"));
    }
    out.push_str(&format!("cwd:  {}\nshell: {}\n$ {}\n", cwd, act.shell, cmd));

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precondition_routes_unsupervised_to_fallback() {
        // omniroute 的真实处境：端口在跑，但 launchd job 从未加载。
        // 此时 start 的前置条件 supervised == true 不成立，必须改走 bootstrap。
        assert!(!eval_precondition("supervised == true", SupervisionState::Unsupervised));
        assert!(eval_precondition("supervised == true", SupervisionState::Supervised));
        assert!(eval_precondition("supervised == false", SupervisionState::Unsupervised));
    }

    #[test]
    fn unknown_precondition_fails_open() {
        // 认不出来的条件一律放行：宁可多执行一次，也不要把用户挡在门外
        assert!(eval_precondition("something_else == 1", SupervisionState::Unsupervised));
        assert!(eval_precondition("supervised >= 2", SupervisionState::Supervised));
    }
}
