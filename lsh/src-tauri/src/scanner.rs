use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortEntry {
    pub port: u16,
    pub pid: i32,
    pub command: String,
    pub address: String,
    /// 是否只监听回环地址。对外暴露的服务在 LSH 里要额外提示。
    pub loopback_only: bool,
}

/// 扫描本机所有 TCP LISTEN 端口。
///
/// 用 `lsof -F pcn` 的机器可读输出，避免解析列式输出时被
/// 含空格/多字节字符的进程名坑到（本机 awk 就踩过这个）。
pub fn scan_listening_ports() -> Result<Vec<PortEntry>, String> {
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"])
        .output()
        .map_err(|e| format!("执行 lsof 失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_lsof(&stdout))
}

fn parse_lsof(raw: &str) -> Vec<PortEntry> {
    let mut entries: Vec<PortEntry> = Vec::new();
    let mut seen: std::collections::HashSet<(u16, i32)> = std::collections::HashSet::new();

    let mut pid: Option<i32> = None;
    let mut command: Option<String> = None;

    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        let (tag, value) = line.split_at(1);
        match tag {
            "p" => {
                pid = value.parse().ok();
                command = None;
            }
            "c" => command = Some(value.to_string()),
            "n" => {
                // 形如 127.0.0.1:11434 或 *:11434 或 [::1]:7001
                if let Some(port) = parse_port(value) {
                    if let Some(p) = pid {
                        if seen.insert((port, p)) {
                            entries.push(PortEntry {
                                port,
                                pid: p,
                                command: command.clone().unwrap_or_else(|| "unknown".into()),
                                address: value.to_string(),
                                loopback_only: value.starts_with("127.0.0.1")
                                    || value.starts_with("[::1]"),
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    entries.sort_by(|a, b| a.port.cmp(&b.port));
    entries
}

fn parse_port(addr: &str) -> Option<u16> {
    let clean = addr.trim_end_matches(" (LISTEN)");
    let after_colon = clean.rsplit_once(':').map(|(_, p)| p)?;
    after_colon.parse().ok()
}

/// 找出占用指定端口的进程（用于「端口冲突」检测）
pub fn who_owns(port: u16) -> Option<PortEntry> {
    scan_listening_ports()
        .ok()?
        .into_iter()
        .find(|e| e.port == port)
}

/// 服务是否处于「被监管」状态。
///
/// 这是端口状态之外的一个独立维度：
///   端口在 + 被监管  = 正常
///   端口在 + 未监管  = 现在能用，崩了就没人拉起（omniroute 本机就是这个状态）
///   端口不在 + 未监管 = 停机，且连自愈都没有
/// 只报端口的话第 2 种会显示成绿色，风险被彻底藏起来。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisionState {
    /// 在监管之下，崩溃会自动拉起
    Supervised,
    /// 进程可能在跑，但没人盯着，崩溃即永久停机
    Unsupervised,
    /// 不适用（纯 GUI 应用、手工脚本等本就无监管体系的服务）
    NotApplicable,
    /// 判定失败。绝不能当成"正常"——宁可让用户自己看一眼。
    Unknown,
}

/// 查 launchd job 是否已加载。
///
/// 用 `launchctl list <label>`：已加载 exit 0，未加载 exit 113。
/// 比 `launchctl print gui/$UID/<label>` 省事，不需要拼 domain。
///
/// 坑：job 未加载时直接 kickstart 会失败。客户端必须先 bootstrap（需要 plist 路径）。
pub fn launchd_job_loaded(label: &str) -> SupervisionState {
    match Command::new("launchctl").arg("list").arg(label).output() {
        Ok(out) if out.status.success() => SupervisionState::Supervised,
        // 113 = 查无此 job。这是"确实未加载"，不是错误。
        Ok(out) if out.status.code() == Some(113) => SupervisionState::Unsupervised,
        Ok(_) => SupervisionState::Unknown,
        Err(_) => SupervisionState::Unknown,
    }
}

/// 查容器的重启策略。有 restart policy 才算被监管。
pub fn docker_supervised(container: &str, expect: Option<&str>) -> SupervisionState {
    let out = Command::new("docker")
        .args([
            "inspect",
            "-f",
            "{{.HostConfig.RestartPolicy.Name}}",
            container,
        ])
        .output();

    match out {
        Ok(o) if o.status.success() => {
            let policy = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if policy.is_empty() || policy == "no" || policy == "<no value>" {
                return SupervisionState::Unsupervised;
            }
            match expect {
                Some(want) if policy != want => SupervisionState::Unsupervised,
                _ => SupervisionState::Supervised,
            }
        }
        // 容器不存在（未创建）不等于没监管：start 时照样带 policy 起来。
        // 这里报 Unknown，避免把"还没创建"误判成"配置有问题"。
        _ => SupervisionState::Unknown,
    }
}

/// 按 manifest 的 supervision.check 分派。
pub fn check_supervision(
    check: &str,
    label: Option<&str>,
    container: Option<&str>,
    expect: Option<&str>,
) -> SupervisionState {
    match check {
        "launchd_job" => match label {
            Some(l) => launchd_job_loaded(l),
            None => SupervisionState::Unknown,
        },
        "docker_restart_policy" => match container {
            Some(c) => docker_supervised(c, expect),
            None => SupervisionState::Unknown,
        },
        // 明确靠手工脚本拉起、没有自动重启 —— 恒判未监管。
        // 与 none 的区别：none 是"GUI 应用，用户自己开属正常"，不该报警；
        // manual 是"本该常驻的后台服务却没有守护"，正是要提示用户的。
        "manual" => SupervisionState::Unsupervised,
        _ => SupervisionState::NotApplicable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lsof_field_output() {
        // lsof -F 的输出每行是「单字母标记 + 值」：p=pid、c=command、n=地址。
        // 写夹具时最容易漏掉 c 前缀（写成 "uvicorn" 而不是 "cuvicorn"），
        // 那样会被当成未知标记忽略，command 静默变成 "unknown"。
        let sample = "p1263\ncollama\nn*:11434\np72326\ncuvicorn\nn127.0.0.1:7001\n";
        let out = parse_lsof(sample);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].port, 7001);
        assert_eq!(out[0].pid, 72326);
        assert_eq!(out[0].command, "uvicorn");
        assert!(out[0].loopback_only);
        assert_eq!(out[1].port, 11434);
        assert!(!out[1].loopback_only);
    }
}
