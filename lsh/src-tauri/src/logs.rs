//! 日志中心（V0.2：只读聚合 + 大小体检；copytruncate 旋转在 V0.3 解禁）。
//!
//! 日志源来自各服务 manifest 的 `logs[]`：file / command / container / label。
//! V0.2 做「聚合尾部」+「大小超阈值告警」；真正截断旋转（copytruncate）
//! 属于写操作，留到 V0.3 配合快照/确认。

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::exec;
use crate::model::{LogSource, RotateSpec};
use crate::registry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSourceView {
    pub service_id: String,
    pub source_id: String,
    pub kind: String,
    pub path: Option<String>,
    pub container: Option<String>,
    pub command: Option<String>,
    pub label: Option<String>,
    pub rotate: Option<RotateView>,
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotateView {
    pub max_size: String,
    pub max_bytes: u64,
    pub keep: u8,
    pub strategy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogTail {
    pub source_id: String,
    pub kind: String,
    pub target: String,
    pub lines: String,
    pub truncated_from: Option<u64>,
    pub over_threshold: bool,
    pub rotate: Option<RotateView>,
    pub error: Option<String>,
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

fn rotate_view(r: &RotateSpec) -> RotateView {
    RotateView {
        max_size: r.max_size.clone(),
        max_bytes: parse_size(&r.max_size),
        keep: r.keep,
        strategy: r.strategy.clone(),
    }
}

/// 把 "20MB" / "1GB" / "512KB" 解析成字节数（解析失败回退 0）。
fn parse_size(s: &str) -> u64 {
    let s = s.trim();
    let split = s.find(|c: char| c.is_alphabetic());
    let (num_part, unit) = match split {
        Some(i) => (&s[..i], s[i..].trim().to_lowercase()),
        None => (s, String::new()),
    };
    let n: f64 = num_part.trim().parse().unwrap_or(0.0);
    let mult = match unit.as_str() {
        "kb" => 1024.0,
        "mb" => 1024.0 * 1024.0,
        "gb" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (n * mult) as u64
}

fn source_id_of(src: &LogSource, idx: usize) -> String {
    src.label
        .clone()
        .or_else(|| src.container.clone())
        .or_else(|| src.path.clone())
        .or_else(|| src.command.clone())
        .unwrap_or_else(|| format!("src-{idx}"))
}

pub fn list_log_sources(service_id: &str) -> Result<Vec<LogSourceView>, String> {
    let m = registry::load_manifests()?
        .into_iter()
        .find(|m| m.id == service_id)
        .ok_or_else(|| format!("未找到服务 {service_id}"))?;
    let h = home();
    Ok(m
        .logs
        .iter()
        .enumerate()
        .map(|(i, src)| LogSourceView {
            service_id: service_id.to_string(),
            source_id: source_id_of(src, i),
            kind: src.kind.clone(),
            path: src.path.as_ref().map(|p| registry::expand(p, Some(&h))),
            container: src.container.clone(),
            command: src.command.clone(),
            label: src.label.clone(),
            rotate: src.rotate.as_ref().map(rotate_view),
            ignore_patterns: src.ignore_patterns.clone(),
        })
        .collect())
}

pub fn tail_logs(service_id: &str, lines: u32) -> Result<Vec<LogTail>, String> {
    let m = registry::load_manifests()?
        .into_iter()
        .find(|m| m.id == service_id)
        .ok_or_else(|| format!("未找到服务 {service_id}"))?;
    let h = home();
    let n = lines.max(1).min(2000) as usize;

    let mut out = Vec::new();
    for (i, src) in m.logs.iter().enumerate() {
        let sid = source_id_of(src, i);
        let rotate = src.rotate.as_ref().map(rotate_view);
        let mut tail = LogTail {
            source_id: sid.clone(),
            kind: src.kind.clone(),
            target: String::new(),
            lines: String::new(),
            truncated_from: None,
            over_threshold: false,
            rotate: rotate.clone(),
            error: None,
        };

        match src.kind.as_str() {
            "file" => {
                let path = match &src.path {
                    Some(p) => registry::expand(p, Some(&h)),
                    None => {
                        tail.error = Some("file 源缺少 path".into());
                        out.push(tail);
                        continue;
                    }
                };
                tail.target = path.clone();
                match read_tail(&path, n) {
                    Ok((text, total)) => {
                        tail.lines = text;
                        if total > n as u64 {
                            tail.truncated_from = Some(total);
                        }
                        if let Some(r) = &rotate {
                            if r.max_bytes > 0 {
                                if let Ok(meta) = std::fs::metadata(&path) {
                                    tail.over_threshold = meta.len() > r.max_bytes;
                                }
                            }
                        }
                    }
                    Err(e) => tail.error = Some(e),
                }
            }
            "container" => {
                let c = src.container.clone().unwrap_or_default();
                tail.target = format!("docker logs {c}");
                let cmd = format!(
                    "docker logs --tail {n} {c} 2>&1 | tail -n {n}"
                );
                tail.lines = run_capture(&cmd);
            }
            "command" => {
                let c = src.command.clone().unwrap_or_default();
                tail.target = c.clone();
                tail.lines = run_capture(&format!("{c} | tail -n {n}"));
            }
            "label" => {
                // launchd job 的 stdout/stderr 走 ASL / log，需要 `log stream`，
                // 属于流式订阅，V0.2 不做实时；这里给出提示而非失败。
                tail.target = src.label.clone().unwrap_or_default();
                tail.error = Some("label 源需 log stream 实时订阅，V0.3 接入".into());
            }
            other => {
                tail.error = Some(format!("未知日志源类型：{other}"));
            }
        }
        out.push(tail);
    }
    Ok(out)
}

/// copytruncate 旋转：先把当前日志备份（带时间戳），再截断为 0 字节。
/// 与 SQLite 不同，纯文本日志没有 WAL，cp + truncate 是安全的。
pub fn rotate_log(service_id: &str, source_id: String) -> Result<String, String> {
    let sources = list_log_sources(service_id)?;
    let src = sources
        .iter()
        .find(|s| s.source_id == source_id)
        .ok_or_else(|| format!("未找到日志源 {source_id}"))?;
    let path = src
        .path
        .clone()
        .ok_or_else(|| format!("日志源 {source_id} 不是 file 类型，无法旋转"))?;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("日志文件不存在：{path}"));
    }
    let ts = chrono_like_stamp();
    let backup = format!("{path}.{ts}.bak");
    std::fs::copy(&p, &backup).map_err(|e| format!("备份失败: {e}"))?;
    std::fs::write(&p, b"").map_err(|e| format!("截断失败: {e}"))?;
    Ok(format!("已备份至 {backup} 并清空原文件（{path}）"))
}

/// 读文件尾部 n 行（从末尾回溯，不整文件载入大文件）。
fn read_tail(path: &str, n: usize) -> Result<(String, u64), String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).map_err(|e| format!("打开 {path} 失败: {e}"))?;
    let total = f.metadata().map(|m| m.len()).unwrap_or(0);
    // 从末尾回溯至多 256KB 来定位最后 n 行（足够覆盖绝大多数日志尾部）
    let seek = total.saturating_sub(256 * 1024);
    let _ = f.seek(SeekFrom::Start(seek));
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| format!("读取 {path} 失败: {e}"))?;
    let text = String::from_utf8_lossy(&buf);
    let all_lines: Vec<&str> = text.lines().collect();
    let start = all_lines.len().saturating_sub(n);
    let tail = all_lines[start..].join("\n");
    Ok((tail, total))
}

fn run_capture(cmd: &str) -> String {
    let (prog, base) = exec::split_shell("/bin/zsh -lc");
    match exec::run_blocking(prog, &base, cmd, ".", &HashMap::new(), 15_000) {
        Ok(o) => o.combined,
        Err(e) => format!("(捕获失败: {e})"),
    }
}

/// 轻量时间戳（不引入 chrono 依赖）。
fn chrono_like_stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // YYYYMMDD-HHMMSS 风格（本地时区近似用 UTC，够用于备份命名）
    let secs = now % 60;
    let mins = (now / 60) % 60;
    let hours = (now / 3600) % 24;
    let days = now / 86400;
    format!("{days:05}-{hours:02}:{mins:02}:{secs:02}")
}
