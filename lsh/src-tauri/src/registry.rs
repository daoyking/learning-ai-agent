use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::model::ServiceManifest;

/// Manifest 的查找顺序：
///   1. ~/.lsh/services/*.yaml   （用户自定义 / 覆盖内置）
///   2. <project>/manifests/services/*.yaml （仓库内置，dev 与首启时使用）
pub fn manifest_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs_next() {
        let user_dir = home.join(".lsh").join("services");
        if user_dir.is_dir() {
            dirs.push(user_dir);
        }
    }
    dirs.push(builtin_manifest_dir());
    dirs
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn builtin_manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("manifests")
        .join("services")
}

/// 加载所有 manifest。同名 id 以先出现的为准（用户目录优先覆盖内置）。
pub fn load_manifests() -> Result<Vec<ServiceManifest>, String> {
    let mut out: Vec<ServiceManifest> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    for dir in manifest_dirs() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s == "yaml" || s == "yml")
                    .unwrap_or(false)
            })
            .collect();
        files.sort();

        for path in files {
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
            let manifest: ServiceManifest = serde_yaml::from_str(&raw)
                .map_err(|e| format!("解析 {} 失败: {e}", path.display()))?;

            if let Some(&idx) = seen.get(&manifest.id) {
                // 同 id 重复：保留先加载的（用户目录优先级更高）
                let _ = &mut out[idx];
                continue;
            }
            seen.insert(manifest.id.clone(), out.len());
            out.push(manifest);
        }
    }

    Ok(out)
}

/// 变量展开：${home} / ${uid} / ${env:VAR} / 开头 ~
pub fn expand(input: &str, home: Option<&str>) -> String {
    let mut s = input.to_string();

    if let Some(h) = home {
        s = s.replace("${home}", h);
    }
    s = s.replace("${uid}", &current_uid());

    // ${env:VAR}
    while let Some(start) = s.find("${env:") {
        if let Some(end) = s[start..].find('}') {
            let key = &s[start + 6..start + end];
            let value = std::env::var(key).unwrap_or_default();
            s = format!("{}{}{}", &s[..start], value, &s[start + end + 1..]);
        } else {
            break;
        }
    }

    // 行首 ~ 展开
    if let Some(home_dir) = dirs_next() {
        if s == "~" {
            s = home_dir.to_string_lossy().to_string();
        } else if let Some(rest) = s.strip_prefix("~/") {
            s = home_dir.join(rest).to_string_lossy().to_string();
        }
    }

    s
}

fn current_uid() -> String {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "501".into())
}
