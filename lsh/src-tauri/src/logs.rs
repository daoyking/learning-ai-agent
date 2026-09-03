//! 日志中心：只读聚合尾部 + 大小体检 + copytruncate 旋转。
//!
//! 日志源来自各服务 manifest 的 `logs[]`：file / command / container / label。
//!
//! 旋转策略为什么是 copytruncate 而不是 rename：
//! launchd / 常驻进程持有的是原文件的 fd。一旦 rename，进程会继续往那个
//! 已经没有目录项的 inode 里写，日志就"消失"了 —— 磁盘照涨，文件却看不到。
//! copytruncate（先复制再原地截断为 0）保持 inode 不变，写入端毫无感知。

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

/// copytruncate 旋转：先把当前日志备份（带时间戳），再原地截断为 0 字节。
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

    let keep = src.rotate.as_ref().map(|r| r.keep).unwrap_or(3);
    let backup = copytruncate(&p)?;
    let pruned = prune_backups(&path, keep);

    let mut msg = format!("已备份至 {backup} 并原地清空 {path}（inode 不变，写入端无感知）");
    if pruned > 0 {
        msg.push_str(&format!("；按 keep={keep} 清理了 {pruned} 个更早的备份"));
    }
    Ok(msg)
}

/// 复制后原地截断。返回备份文件路径。
///
/// 刻意不使用 rename：见文件头注释，rename 会让持有 fd 的进程写到孤儿 inode。
fn copytruncate(p: &std::path::Path) -> Result<String, String> {
    let path = p.to_string_lossy().to_string();
    let ts = chrono_like_stamp();
    let backup = format!("{path}.{ts}.bak");
    std::fs::copy(p, &backup).map_err(|e| format!("备份失败: {e}"))?;
    std::fs::write(p, b"").map_err(|e| format!("截断失败: {e}"))?;
    Ok(backup)
}

/// 只保留最近 keep 个备份，删掉更早的。返回删除数量。
///
/// 备份名形如 `<日志名>.<days>-<hh>-<mm>-<ss>.bak`，各段定宽，
/// 所以字典序等价于时间序，直接 sort 即可。
fn prune_backups(path: &str, keep: u8) -> usize {
    let p = std::path::Path::new(path);
    let (dir, base) = match (p.parent(), p.file_name()) {
        (Some(d), Some(b)) => (d, b.to_string_lossy().to_string()),
        _ => return 0,
    };
    let prefix = format!("{base}.");

    let mut found: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".bak") {
                found.push(entry.path());
            }
        }
    }
    found.sort();

    let excess = found.len().saturating_sub(keep.max(1) as usize);
    for old in found.iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
    excess
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
    // 各段定宽，字典序即时间序，prune_backups 直接 sort 就行。
    // 用短横线而不是冒号分隔：冒号在跨平台/跨 shell 下容易被转义问题咬到。
    let secs = now % 60;
    let mins = (now / 60) % 60;
    let hours = (now / 3600) % 24;
    let days = now / 86400;
    format!("{days:05}-{hours:02}-{mins:02}-{secs:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lsh-logs-{name}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("建临时目录");
        d
    }

    #[test]
    fn copytruncate_preserves_inode_and_empties_file() {
        // 旋转的核心保证：inode 不变（持有 fd 的进程写得进去），大小为 0。
        use std::os::unix::fs::MetadataExt;
        let dir = tmpdir("rotate");
        let log = dir.join("svc.log");
        std::fs::write(&log, "line1\nline2\n").unwrap();
        let ino_before = std::fs::metadata(&log).unwrap().ino();

        let backup = copytruncate(&log).expect("旋转应成功");

        assert_eq!(std::fs::read_to_string(&log).unwrap(), "", "原文件应被清空");
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "line1\nline2\n",
            "备份应保留原内容"
        );
        assert_eq!(
            std::fs::metadata(&log).unwrap().ino(),
            ino_before,
            "inode 必须不变，否则持有 fd 的写入端会写到孤儿 inode"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_keeps_only_latest_backups() {
        let dir = tmpdir("prune");
        let log = dir.join("svc.log");
        std::fs::write(&log, "x").unwrap();
        for i in 0..5 {
            std::fs::write(dir.join(format!("svc.log.{i:05}-00-00-00.bak")), "x").unwrap();
        }

        let removed = prune_backups(&log.to_string_lossy(), 3);

        assert_eq!(removed, 2, "5 个备份 keep=3 应删掉 2 个");
        let left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".bak"))
            .collect();
        assert_eq!(left.len(), 3);
        assert!(
            left.contains(&"svc.log.00004-00-00-00.bak".to_string()),
            "最新的备份必须留下，实际: {left:?}"
        );
        assert!(
            !left.contains(&"svc.log.00000-00-00-00.bak".to_string()),
            "最旧的备份应被删除，实际: {left:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_never_touches_unrelated_files() {
        // 只认 <同名>.<时间戳>.bak，别把别人的文件删了
        let dir = tmpdir("prune-safe");
        let log = dir.join("svc.log");
        std::fs::write(&log, "x").unwrap();
        std::fs::write(dir.join("svc.log.bak"), "x").unwrap();
        std::fs::write(dir.join("other.log.00001-00-00-00.bak"), "x").unwrap();
        std::fs::write(dir.join("important.txt"), "x").unwrap();

        prune_backups(&log.to_string_lossy(), 1);

        assert!(dir.join("important.txt").exists(), "无关文件不能被删");
        assert!(dir.join("other.log.00001-00-00-00.bak").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
