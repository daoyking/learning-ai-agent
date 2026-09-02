//! 环境体检 Doctor（V0.2：只读电池化自检）。
//!
//! 把"这台机器现在健康吗"拆成一组成败分明的检查项，每一项都是可观测事实：
//!   - node 可用性（探针 / sqlite 都依赖）
//!   - 各服务探针是否通过（复用 pb::run_all_probes）
//!   - 运行中但无人监管（unsupervised）的服务 —— 崩了起不来的一等风险
//!   - 端口冲突（声明端口被别的进程占了）
//!
//! 不修任何东西，只报。修复走 Playbook 引擎。

use serde::{Deserialize, Serialize};

use crate::pb;
use crate::registry;
use crate::scanner;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorCheck {
    pub id: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
}

pub fn run_doctor() -> Result<Vec<DoctorCheck>, String> {
    let mut checks: Vec<DoctorCheck> = Vec::new();

    // 1) node 可用性：探针与 sqlite 查询都依赖它
    let node_ok = std::process::Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    checks.push(DoctorCheck {
        id: "node".into(),
        title: "Node.js 运行时".to_string(),
        status: if node_ok { CheckStatus::Ok } else { CheckStatus::Fail },
        detail: if node_ok {
            "node 可用，L3 探针与 sqlite 诊断可运行".into()
        } else {
            "未找到 node，诊断探针与 sqlite 查询将无法运行".into()
        },
    });

    // 2) 端口扫描 + manifest 合成（复用 scanner）
    let ports = scanner::scan_listening_ports().unwrap_or_default();
    let manifests = registry::load_manifests()?;

    // 3) 探针体检（联网，显式触发）
    let probes = pb::run_all_probes().unwrap_or_default();
    let failed_probes: Vec<&pb::ProbeRun> = probes.iter().filter(|p| !p.ok).collect();
    checks.push(DoctorCheck {
        id: "probes".into(),
        title: "L3 语义探针".to_string(),
        status: if failed_probes.is_empty() {
            CheckStatus::Ok
        } else {
            CheckStatus::Warn
        },
        detail: if failed_probes.is_empty() {
            format!("全部 {} 个探针通过（含缺凭据跳过项视为通过）", probes.len())
        } else {
            let names: Vec<String> = failed_probes
                .iter()
                .map(|p| format!("{}.{}", p.service, p.probe))
                .collect();
            format!("{} 个探针未通过：{}", failed_probes.len(), names.join(", "))
        },
    });

    // 4) 每个服务的监管状态 + 端口冲突
    for m in &manifests {
        let supervised = scanner::check_supervision(
            &m.supervisor.supervision.check,
            m.supervisor.label.as_deref(),
            m.supervisor.container.as_deref(),
            m.supervisor.supervision.expect.as_deref(),
        );
        let listening = m
            .detect
            .ports
            .iter()
            .any(|p| ports.iter().any(|e| e.port == *p));

        // 运行中但无人监管 → 警告
        if listening && supervised == scanner::SupervisionState::Unsupervised {
            checks.push(DoctorCheck {
                id: format!("supervision-{}", m.id),
                title: format!("{} 监管状态", m.name),
                status: CheckStatus::Warn,
                detail: format!(
                    "端口在监听、进程在跑，但没有守护（launchd/docker restart 均未生效）。崩了不会自动拉起。"
                ),
            });
        } else if supervised == scanner::SupervisionState::Supervised {
            checks.push(DoctorCheck {
                id: format!("supervision-{}", m.id),
                title: format!("{} 监管状态", m.name),
                status: CheckStatus::Ok,
                detail: "受监管（崩溃会被自动拉起）".into(),
            });
        }

        // 端口冲突
        for p in &m.detect.ports {
            if let Some(owner) = scanner::who_owns(*p) {
                if !listening {
                    checks.push(DoctorCheck {
                        id: format!("port-{}", m.id),
                        title: format!("{} 端口 {}", m.name, p),
                        status: CheckStatus::Warn,
                        detail: format!("声明端口 :{p} 被其它进程占用（{} pid {}）", owner.command, owner.pid),
                    });
                }
            }
        }
    }

    // 汇总到最前面：一眼看到整体结论
    let fail = checks.iter().filter(|c| c.status == CheckStatus::Fail).count();
    let warn = checks.iter().filter(|c| c.status == CheckStatus::Warn).count();
    checks.insert(
        0,
        DoctorCheck {
            id: "summary".into(),
            title: "整体结论".to_string(),
            status: if fail > 0 {
                CheckStatus::Fail
            } else if warn > 0 {
                CheckStatus::Warn
            } else {
                CheckStatus::Ok
            },
            detail: format!("失败 {fail} · 警告 {warn} · 共 {} 项", checks.len()),
        },
    );

    Ok(checks)
}
