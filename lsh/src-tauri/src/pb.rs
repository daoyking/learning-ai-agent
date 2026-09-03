//! Playbook 引擎（V0.2）：加载 + 触发匹配 + 只读诊断 + 结论推导。
//!
//! 安全模型（见 docs/PLAYBOOK-DSL.md）：
//!   - 表达式语言是**白名单解析器**，绝不使用 eval / 任意运行时求值。
//!   - diagnose 阶段每一步都只读（exec 只跑 SELECT/cat/echo 类；sqlite 用 readOnly）。
//!   - V0.2 强制所有剧本按 manual 处理：只产出结论 + 证据链 + 修复命令，绝不代执行写操作。
//!   - 触发匹配（match）不联网；真正跑探针只在用户显式触发的 diagnose / run_probes 里。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::exec;
use crate::registry;

// ───────────────────────────── 解析结构体（对齐 playbook.schema.json） ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Playbook {
    pub schema: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub symptom: Option<String>,
    pub trigger: Trigger,
    pub diagnose: Vec<DiagnoseStep>,
    pub conclude: Vec<ConclusionSpec>,
    #[serde(default)]
    pub fix: Option<Fix>,
    #[serde(default)]
    pub verify: Option<Verify>,
    #[serde(default)]
    pub rollback: Option<Rollback>,
    #[serde(default = "default_risk")]
    pub risk: String,
    #[serde(default = "default_side_effect")]
    pub side_effects: String,
    #[serde(default)]
    pub requires_sudo: bool,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trigger {
    #[serde(default)]
    pub any_of: Vec<Condition>,
    #[serde(default)]
    pub all_of: Vec<Condition>,
    #[serde(default = "default_cooldown")]
    pub cooldown_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    #[serde(default)]
    pub probe: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub log_match: Option<LogMatch>,
    #[serde(default)]
    pub cmd: Option<TriggerCmd>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogMatch {
    #[serde(default)]
    pub source: Option<String>,
    pub pattern: String,
    #[serde(default = "default_window")]
    pub window: String,
    #[serde(default = "default_count")]
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TriggerCmd {
    pub run: String,
    #[serde(default)]
    pub expect_exit: Option<i32>,
    #[serde(default)]
    pub expect_output: Option<String>,
    #[serde(default)]
    pub expect_not_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnoseStep {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub exec: Option<ExecSpec>,
    #[serde(default)]
    pub read_file: Option<String>,
    #[serde(default)]
    pub sqlite_query: Option<SqliteQuery>,
    #[serde(default)]
    pub capture: Option<String>,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecSpec {
    pub cmd: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default = "default_exec_timeout")]
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SqliteQuery {
    pub file: String,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConclusionSpec {
    pub when: String,
    pub root_cause: String,
    #[serde(default = "default_confidence")]
    pub confidence: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub recommended_fix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fix {
    #[serde(default = "default_fix_mode")]
    pub mode: String,
    #[serde(default = "default_true")]
    pub confirm: bool,
    #[serde(default)]
    pub backup: Vec<String>,
    #[serde(default)]
    pub steps: Vec<FixStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixStep {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(rename = "type", default = "default_step_type")]
    pub kind: String,
    #[serde(default)]
    pub cmd: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub sql: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub value: Option<serde_yaml::Value>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default = "default_fixstep_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub instruction: Option<String>,
    #[serde(default = "default_snapshot")]
    pub snapshot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verify {
    #[serde(default)]
    pub probe: Option<String>,
    #[serde(default)]
    pub expect: Option<String>,
    #[serde(default)]
    pub cmd: Option<String>,
    #[serde(default = "default_verify_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rollback {
    #[serde(default = "default_true")]
    pub from_snapshot: bool,
    #[serde(default)]
    pub steps: Vec<FixStep>,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_severity() -> String { "warn".into() }
fn default_category() -> String { "config".into() }
fn default_cooldown() -> u64 { 600_000 }
fn default_window() -> String { "15m".into() }
fn default_count() -> u32 { 1 }
fn default_exec_timeout() -> u64 { 15_000 }
fn default_confidence() -> String { "medium".into() }
fn default_fix_mode() -> String { "manual".into() }
fn default_true() -> bool { true }
fn default_risk() -> String { "medium".into() }
fn default_side_effect() -> String { "restart-service".into() }
fn default_step_type() -> String { "exec".into() }
fn default_fixstep_timeout() -> u64 { 30_000 }
fn default_snapshot() -> bool { true }
fn default_verify_timeout() -> u64 { 60_000 }

// ───────────────────────────── 对外响应结构体（序列化给前端） ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookSummary {
    pub id: String,
    pub title: String,
    pub service: Option<String>,
    pub severity: String,
    pub category: String,
    pub symptom: Option<String>,
    pub has_fix: bool,
    pub risk: String,
    pub requires_sudo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MatchContext {
    /// key = "service.probeId"，value = 探针输出的 JSON 对象（顶层 key 会被展开成变量）。
    pub probe_vars: HashMap<String, Value>,
    pub home: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedPlaybook {
    pub id: String,
    pub title: String,
    pub service: Option<String>,
    pub severity: String,
    pub category: String,
    pub symptom: Option<String>,
    pub trigger_summary: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnoseStepOut {
    pub id: String,
    pub title: String,
    pub cmd: Option<String>,
    pub output: String,
    pub exit: i32,
    pub captured: Option<Value>,
    pub error: Option<String>,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConclusionOut {
    pub when: String,
    pub root_cause: String,
    pub confidence: String,
    pub evidence: Vec<String>,
    pub recommended_fix: Option<String>,
    pub matched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixStepPreview {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub command: String,
    pub snapshot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixPreview {
    pub mode: String,
    pub confirm: bool,
    pub risk: String,
    pub side_effects: String,
    pub requires_sudo: bool,
    pub steps: Vec<FixStepPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixStepOut {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub command: String,
    pub output: Option<String>,
    pub exit: Option<i32>,
    pub error: Option<String>,
    pub skipped: bool,
    pub skip_reason: Option<String>,
    pub rolled_back: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyOut {
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixApplyResult {
    pub executed: bool,
    pub needs_confirm: bool,
    pub rejected_sudo: bool,
    pub mode: String,
    pub steps: Vec<FixStepOut>,
    pub verify: Option<VerifyOut>,
    pub rollback_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnoseResult {
    pub id: String,
    pub title: String,
    pub severity: String,
    pub category: String,
    pub symptom: Option<String>,
    pub source: Option<String>,
    pub steps: Vec<DiagnoseStepOut>,
    pub vars: Value,
    pub partial: bool,
    pub conclusions: Vec<ConclusionOut>,
    pub fix: Option<FixPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeRun {
    pub service: String,
    pub probe: String,
    pub ok: bool,
    pub raw: String,
    pub vars: Value,
}

// ───────────────────────────── 加载器 ─────────────────────────────

pub fn playbook_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("manifests")
        .join("playbooks")
}

pub fn load_playbooks() -> Result<Vec<Playbook>, String> {
    let dir = playbook_dir();
    let mut out: Vec<Playbook> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
            if ext != "yaml" && ext != "yml" {
                continue;
            }
            let raw = std::fs::read_to_string(&p)
                .map_err(|e| format!("读取 {} 失败: {e}", p.display()))?;
            match serde_yaml::from_str::<Playbook>(&raw) {
                Ok(pb) => out.push(pb),
                Err(e) => failed.push(format!(
                    "{}: {e}",
                    p.file_name().and_then(|s| s.to_str()).unwrap_or("?")
                )),
            }
        }
    }

    if out.is_empty() && !failed.is_empty() {
        return Err(format!("所有剧本解析失败:\n{}", failed.join("\n")));
    }
    if !failed.is_empty() {
        eprintln!(
            "[lsh playbook] 跳过 {} 个解析失败的剧本:\n{}",
            failed.len(),
            failed.join("\n")
        );
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub fn get_playbook(id: &str) -> Result<Playbook, String> {
    load_playbooks()?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| format!("未找到剧本 {id}"))
}

pub fn list_playbooks_meta() -> Result<Vec<PlaybookSummary>, String> {
    Ok(load_playbooks()?
        .into_iter()
        .map(|b| PlaybookSummary {
            id: b.id,
            title: b.title,
            service: b.service,
            severity: b.severity,
            category: b.category,
            symptom: b.symptom,
            has_fix: b.fix.is_some(),
            risk: b.risk,
            requires_sudo: b.requires_sudo,
        })
        .collect())
}

// ───────────────────────────── 探针运行（联网，仅在显式触发的 diagnose / run_probes 里） ─────────────────────────────

fn probe_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("manifests")
        .join("probes")
}

/// 运行单个 L3 探针。支持 4 种 type：
///   script      — node <path>，末行 JSON 为结果（保留原始 ok 字段，assert 可选）
///   http_json   — curl <url> + jq <jq> 抽子路径，eval <assert> 作断言
///   llm_echo    — POST /api/chat（Ollama 兼容），返回 {done, ms, ok}
///   container_exec — docker exec <container> <cmd>， stdout 末行 JSON
pub fn run_probe(service: &str, probe: &str) -> Result<Value, String> {
    let manifests = registry::load_manifests()?;
    let m = manifests
        .iter()
        .find(|m| m.id == service)
        .ok_or_else(|| format!("找不到服务 {service}"))?;
    let l3 = m
        .health
        .l3
        .iter()
        .find(|p| p.id == probe)
        .ok_or_else(|| format!("服务 {service} 无探针 {probe}"))?;
    match l3.r#type.as_str() {
        "script" => run_probe_script(service, probe, l3, true), // 不强制 assert（保留原始 ok）
        "http_json" => run_probe_http_json(service, probe, l3), // 强制 assert
        "llm_echo" => run_probe_llm_echo(service, probe, l3),
        "container_exec" => run_probe_container(service, probe, l3), // 强制 assert
        other => Err(format!("未知探针类型 {other}: {service}.{probe}")),
    }
}

fn run_probe_script(service: &str, probe: &str, l3: &crate::model::ProbeL3, enforce_assert: bool) -> Result<Value, String> {
    let script = l3
        .script
        .as_deref()
        .ok_or_else(|| format!("探针 {probe} 未声明 script"))?;
    let rel = script.trim_start_matches("probes/");
    let path = probe_path().join(rel);
    let out = exec::run_blocking("node", &[], &path.to_string_lossy().to_string(), ".", &HashMap::new(), l3.timeout_ms)
        .map_err(|e| format!("运行探针 {service}.{probe} 失败: {e}"))?;
    let v = parse_last_json(&out.combined)
        .ok_or_else(|| format!("探针 {service}.{probe} 输出非 JSON: {}", out.combined.trim()))?;
    if enforce_assert {
        apply_assert(service, probe, &v, l3.assert.as_deref(), &HashMap::new())
    } else {
        Ok(v) // 保留探针自己的 ok 字段
    }
}

fn run_probe_http_json(service: &str, probe: &str, l3: &crate::model::ProbeL3) -> Result<Value, String> {
    let url = l3.url.as_deref()
        .ok_or_else(|| format!("探针 {probe} 缺 url"))?;
    let method = l3.method.as_str();
    let jq = l3.jq.as_deref().unwrap_or(".");
    let timeout = l3.timeout_ms.max(1);
    // 构造 curl 参数列表
    let mut args: Vec<String> = vec![
        "--silent".into(),
        "--max-time".into(), timeout.to_string(),
        "-X".into(), method.into(),
        "-H".into(), "Content-Type: application/json".into(),
        url.into(),
    ];
    if let Some(b) = &l3.body {
        args.push("-d".into());
        args.push(serde_json::to_string(b).map_err(|e| format!("body 序列化失败: {e}"))?);
    }
    // 直接用 Command 而非 run_blocking：run_blocking 会把 cmd 参数追加到 base_args 后面，
    // 而我们这里需要精确控制参数顺序，URL 必须是最后一个位置参数。
    // 同时注入 NO_PROXY 避免沙箱代理劫持本地请求。
    let mut command = std::process::Command::new("curl");
    command.env("NO_PROXY", "127.0.0.1,localhost")
        .args(&args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn()
        .map_err(|e| format!("curl 启动失败 [{service}.{probe}]: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis((timeout + 1000).min(30_000));
    let mut timed_out = false;
    let out = loop {
        match child.try_wait().map_err(|e| format!("curl 等待失败 [{service}.{probe}]: {e}"))? {
            Some(_) => break child.wait_with_output().map_err(|e| format!("curl 读取输出失败 [{service}.{probe}]: {e}"))?,
            None => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break child.wait_with_output().map_err(|e| format!("curl 超时读取输出失败 [{service}.{probe}]: {e}"))?;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    };
    if timed_out {
        return Ok(serde_json::json!({
            "ok": false,
            "probe": probe,
            "service": service,
            "error": format!("curl 超时（{}ms）", timeout),
        }));
    }
    let code = out.status.code().unwrap_or(-1);
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if code != 0 {
        return Ok(serde_json::json!({
            "ok": false,
            "probe": probe,
            "service": service,
            "error": format!("curl 退出 {} {}", code, combined.trim().chars().take(200).collect::<String>()),
        }));
    }
    let raw_text = combined.trim().to_string();
    // 先保存 curl 原始响应（clone，后面 jq 会 move 掉 parsed 里的值）
    let raw_response = serde_json::from_str(&raw_text)
        .unwrap_or(serde_json::json!({"_raw": raw_text}));
    let parsed: Result<Value, _> = serde_json::from_str(&raw_text);
    let mut raw: Value = match &parsed {
        Ok(v) => v.clone(),
        Err(_) => serde_json::json!({"_raw": raw_text}),
    };
    if !jq.is_empty() && jq != "." {
        let parts: Vec<&str> = jq.split('.').filter(|s| !s.is_empty()).collect();
        for part in parts {
            raw = match &raw {
                Value::Object(m) => m.get(part).cloned().unwrap_or(Value::Null),
                Value::Array(a) if let Ok(idx) = part.parse::<usize>() => a.get(idx).cloned().unwrap_or(Value::Null),
                _ => return Ok(serde_json::json!({"ok": false, "probe": probe, "service": service, "error": format!("jq 路径 .{part} 在结果中不存在"), "path": jq})),
            };
        }
    }
    // jq 结果之外，把 curl 原始响应也注入为 `raw_response`，
    // 这样 assert 可以用 `len(raw_response.models) > 0` 引用原始结构。
    // 同时保留 `result` 键，指向当前（已 jq 后的）值。
    let mut scope: HashMap<String, Value> = HashMap::new();
    scope.insert("raw_response".into(), raw_response);
    scope.insert("result".into(), raw.clone());
    apply_assert(service, probe, &raw, l3.assert.as_deref(), &scope)
}

fn run_probe_llm_echo(service: &str, probe: &str, l3: &crate::model::ProbeL3) -> Result<Value, String> {
    let url = l3.url.as_ref()
        .ok_or_else(|| format!("探针 {probe} 缺 url"))?;
    let model = l3.model.as_ref()
        .ok_or_else(|| format!("探针 {probe} 缺 model"))?;
    let timeout_ms = l3.timeout_ms.max(1000);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": false
    });
    let body_str = serde_json::to_string(&body).unwrap();
    let timeout_cap = std::cmp::min(timeout_ms, 60_000);
    // 直接用 Command 而非 run_blocking：避免 /dev/null 被追加为 curl 的最终参数
    // 同时注入 NO_PROXY 避免沙箱代理劫持本地请求
    let mut command = std::process::Command::new("curl");
    command.env("NO_PROXY", "127.0.0.1,localhost");
    command.args(&[
        "--silent",
        "--max-time", &timeout_cap.to_string(),
        "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", &body_str,
        url,
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    let mut child = command.spawn()
        .map_err(|e| format!("curl 启动失败 [{service}.{probe}]: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis((timeout_cap + 1000).min(65_000));
    let mut timed_out = false;
    let out = loop {
        match child.try_wait().map_err(|e| format!("curl 等待失败 [{service}.{probe}]: {e}"))? {
            Some(_) => break child.wait_with_output().map_err(|e| format!("curl 读取输出失败 [{service}.{probe}]: {e}"))?,
            None => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break child.wait_with_output().map_err(|e| format!("curl 超时读取输出失败 [{service}.{probe}]: {e}"))?;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    };
    if timed_out {
        return Ok(serde_json::json!({
            "ok": false,
            "probe": probe,
            "service": service,
            "error": format!("curl 超时（{}ms）", timeout_cap),
        }));
    }
    let code = out.status.code().unwrap_or(-1);
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if code != 0 {
        return Ok(serde_json::json!({
            "ok": false,
            "probe": probe,
            "service": service,
            "error": format!("curl 退出 {} {}", code, combined.trim().chars().take(200).collect::<String>()),
        }));
    }
    let resp: Value = serde_json::from_str(&combined)
        .unwrap_or(serde_json::json!({}));
    let done = resp.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
    let ms = resp.get("eval_duration_ms")
        .or_else(|| resp.get("eval_duration"))
        .and_then(|v| v.as_u64())
        .unwrap_or(timeout_ms);
    Ok(serde_json::json!({
        "ok": done,
        "probe": probe,
        "service": service,
        "model": model,
        "ms": ms,
        "done": done,
    }))
}

fn run_probe_container(service: &str, probe: &str, l3: &crate::model::ProbeL3) -> Result<Value, String> {
    let container = l3.container.as_ref()
        .ok_or_else(|| format!("探针 {probe} 缺 container"))?;
    let cmd = l3.exec.first()
        .ok_or_else(|| format!("探针 {probe} 缺 exec 命令"))?;
    let timeout = l3.timeout_ms.max(1);
    let docker_args: Vec<&str> = vec![
        "run", "--rm",
        "--network", "none",
        container,
        "/bin/sh", "-c", cmd,
    ];
    let out = exec::run_blocking("docker", &docker_args, "/dev/null", ".", &HashMap::new(), timeout + 1000)
        .map_err(|e| format!("docker exec 失败 [{service}.{probe}]: {e}"))?;
    let v = parse_last_json(&out.combined)
        .ok_or_else(|| format!("探针 {service}.{probe} 容器输出非 JSON: {}", out.combined.trim()))?;
    apply_assert(service, probe, &v, l3.assert.as_deref(), &HashMap::new())
}

/// 若 l3.assert 存在，用 eval_expr 求值；通过返回原始结果，不通过返回 {ok:false, error}
///
/// 变量作用域（按优先级）：
///   - `result` = jq 提取后的探针结果（始终可用）
///   - `raw_response` = curl 原始响应（http_json 类型提供）
///   - result 顶层字段展平（如 `models` / `results` / `ok`）也直接注入
///   - extra_scope 由 caller 提供，http_json 注入 raw_response，其他探针传空 HashMap
fn apply_assert(
    service: &str,
    probe: &str,
    result: &Value,
    assert: Option<&str>,
    extra_scope: &HashMap<String, Value>,
) -> Result<Value, String> {
    match assert {
        None => Ok(result.clone()),
        Some(expr) => {
            // 兼容 C 风格 &&/|| → Rust 风格的 and/or（manifest 常用 &&）
            let normalized = expr
                .replace("&&", " and ")
                .replace("||", " or ");
            // 合并作用域：extra_scope > result 顶层字段 > result
            let mut scope = extra_scope.clone();
            if let Value::Object(obj) = result {
                for (k, v) in obj {
                    scope.insert(k.clone(), v.clone());
                }
            }
            scope.insert("result".into(), result.clone());
            let ok = eval_expr(&normalized, &scope)
                .map(|v| truthy(&v))
                .map_err(|e| format!("assert 表达式求值失败 [{service}.{probe}]: {e}"))?;
            if ok {
                // 通过时包装为对象并注入 ok:true，确保 run_all_probes 能通过 v.get("ok") 读取状态
                Ok(serde_json::json!({
                    "ok": true,
                    "probe": probe,
                    "service": service,
                    "result": result,
                }))
            } else {
                Ok(serde_json::json!({
                    "ok": false,
                    "probe": probe,
                    "service": service,
                    "error": format!("assert 失败: {expr}"),
                    "result": result,
                }))
            }
        }
    }
}

fn parse_last_json(s: &str) -> Option<Value> {
    for line in s.lines().filter(|l| !l.trim().is_empty()).rev() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            return Some(v);
        }
    }
    None
}

pub fn run_all_probes() -> Result<Vec<ProbeRun>, String> {
    let manifests = registry::load_manifests()?;
    let mut out = Vec::new();
    for m in &manifests {
        for p in &m.health.l3 {
            match run_probe(&m.id, &p.id) {
                Ok(v) => {
                    let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
                    out.push(ProbeRun {
                        service: m.id.clone(),
                        probe: p.id.clone(),
                        ok,
                        raw: serde_json::to_string(&v).unwrap_or_default(),
                        vars: v,
                    });
                }
                Err(e) => out.push(ProbeRun {
                    service: m.id.clone(),
                    probe: p.id.clone(),
                    ok: false,
                    raw: e,
                    vars: Value::Null,
                }),
            }
        }
    }
    Ok(out)
}

fn flatten_top(obj: &Value) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    if let Value::Object(o) = obj {
        for (k, v) in o {
            m.insert(k.clone(), v.clone());
        }
    }
    m
}

// ───────────────────────────── 表达式语言（白名单 Pratt 解析器） ─────────────────────────────
//
// 6 种 AST 节点：Lit / Var / Unary / Binary / Call / Paren
// 变量路径深度 ≤ 2（a 或 a.b）；callee 必须是内置白名单函数。

#[derive(Debug, Clone)]
enum ExprNode {
    Lit(Value),
    Var { base: String, field: Option<String> },
    Unary { op: String, node: Box<ExprNode> },
    Binary { op: String, left: Box<ExprNode>, right: Box<ExprNode> },
    Call { name: String, args: Vec<ExprNode> },
    Paren(Box<ExprNode>),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    Op(String),
    LP,
    RP,
    Comma,
    Dot,
    LB,
    RB,
}

fn lex(input: &str) -> Result<Vec<Tok>, String> {
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut toks = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        match c {
            '(' => {
                toks.push(Tok::LP);
                i += 1;
            }
            ')' => {
                toks.push(Tok::RP);
                i += 1;
            }
            ',' => {
                toks.push(Tok::Comma);
                i += 1;
            }
            '.' => {
                toks.push(Tok::Dot);
                i += 1;
            }
            '[' => {
                toks.push(Tok::LB);
                i += 1;
            }
            ']' => {
                toks.push(Tok::RB);
                i += 1;
            }
            '\'' => {
                i += 1;
                let mut s = String::new();
                while i < chars.len() {
                    let ch = chars[i];
                    if ch == '\\' && i + 1 < chars.len() {
                        let n = chars[i + 1];
                        s.push(match n {
                            'n' => '\n',
                            't' => '\t',
                            'r' => '\r',
                            '\\' => '\\',
                            '\'' => '\'',
                            other => other,
                        });
                        i += 2;
                        continue;
                    }
                    if ch == '\'' {
                        i += 1;
                        break;
                    }
                    s.push(ch);
                    i += 1;
                }
                toks.push(Tok::Str(s));
            }
            '=' => {
                if i + 1 < chars.len() && chars[i + 1] == '=' {
                    toks.push(Tok::Op("==".into()));
                    i += 2;
                } else {
                    return Err("expr 语法错误：孤立的 '='（比较请用 ==）".into());
                }
            }
            '!' => {
                if i + 1 < chars.len() && chars[i + 1] == '=' {
                    toks.push(Tok::Op("!=".into()));
                    i += 2;
                } else {
                    return Err("expr 语法错误：孤立的 '!'（比较请用 !=）".into());
                }
            }
            '>' => {
                if i + 1 < chars.len() && chars[i + 1] == '=' {
                    toks.push(Tok::Op(">=".into()));
                    i += 2;
                } else {
                    toks.push(Tok::Op(">".into()));
                    i += 1;
                }
            }
            '<' => {
                if i + 1 < chars.len() && chars[i + 1] == '=' {
                    toks.push(Tok::Op("<=".into()));
                    i += 2;
                } else {
                    toks.push(Tok::Op("<".into()));
                    i += 1;
                }
            }
            _ => {
                if c.is_ascii_digit() || (c == '-' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit())
                {
                    let start = i;
                    if c == '-' {
                        i += 1;
                    }
                    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                        i += 1;
                    }
                    let numstr: String = chars[start..i].iter().collect();
                    let n: f64 = numstr
                        .parse()
                        .map_err(|_| format!("非法数字 {numstr}"))?;
                    toks.push(Tok::Num(n));
                } else if c.is_alphabetic() || c == '_' || c == ':' {
                    let start = i;
                    while i < chars.len()
                        && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == ':')
                    {
                        i += 1;
                    }
                    let id: String = chars[start..i].iter().collect();
                    toks.push(Tok::Ident(id));
                } else {
                    return Err(format!("expr 词法错误：无法识别的字符 '{c}'"));
                }
            }
        }
    }
    Ok(toks)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }
    fn bump(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn parse_program(&mut self) -> Result<ExprNode, String> {
        let node = self.parse_or()?;
        if self.pos != self.toks.len() {
            return Err(format!("expr 多余 token：{:?}", self.peek()));
        }
        Ok(node)
    }

    fn parse_or(&mut self) -> Result<ExprNode, String> {
        let mut left = self.parse_and()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Ident(o)) if o == "or" => o.clone(),
                _ => break,
            };
            self.bump();
            let right = self.parse_and()?;
            left = ExprNode::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<ExprNode, String> {
        let mut left = self.parse_unary()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Ident(o)) if o == "and" => o.clone(),
                _ => break,
            };
            self.bump();
            let right = self.parse_unary()?;
            left = ExprNode::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<ExprNode, String> {
        let op = match self.peek() {
            Some(Tok::Ident(o)) if o == "not" => o.clone(),
            _ => return self.parse_cmp(),
        };
        self.bump();
        let node = self.parse_unary()?;
        Ok(ExprNode::Unary {
            op,
            node: Box::new(node),
        })
    }

    fn parse_cmp(&mut self) -> Result<ExprNode, String> {
        let left = self.parse_primary()?;
        if let Some(Tok::Op(op)) = self.peek() {
            let op = op.clone();
            self.bump();
            let right = self.parse_primary()?;
            Ok(ExprNode::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            })
        } else {
            Ok(left)
        }
    }

    fn parse_primary(&mut self) -> Result<ExprNode, String> {
        match self.peek().cloned() {
            Some(Tok::LP) => {
                self.bump();
                let n = self.parse_or()?;
                match self.bump() {
                    Some(Tok::RP) => Ok(ExprNode::Paren(Box::new(n))),
                    _ => Err("expr 缺少右括号 ')'".into()),
                }
            }
            Some(Tok::Num(n)) => {
                self.bump();
                Ok(ExprNode::Lit(Value::Number(
                    serde_json::Number::from_f64(n).unwrap_or(serde_json::Number::from(0)),
                )))
            }
            Some(Tok::Str(s)) => {
                self.bump();
                Ok(ExprNode::Lit(Value::String(s)))
            }
            Some(Tok::Ident(id)) => {
                self.bump();
                match id.as_str() {
                    "true" => return Ok(ExprNode::Lit(Value::Bool(true))),
                    "false" => return Ok(ExprNode::Lit(Value::Bool(false))),
                    "null" => return Ok(ExprNode::Lit(Value::Null)),
                    _ => {}
                }
                if let Some(Tok::LP) = self.peek() {
                    self.bump();
                    let mut args = Vec::new();
                    if !matches!(self.peek(), Some(Tok::RP)) {
                        loop {
                            args.push(self.parse_or()?);
                            match self.peek().cloned() {
                                Some(Tok::Comma) => {
                                    self.bump();
                                }
                                Some(Tok::RP) => break,
                                _ => return Err("函数参数缺少 ',' 或 ')'".into()),
                            }
                        }
                    }
                    self.bump();
                    return Ok(ExprNode::Call { name: id, args });
                }
                let mut field = None;
                if let Some(Tok::Dot) = self.peek() {
                    self.bump();
                    match self.bump() {
                        Some(Tok::Ident(f)) => field = Some(f),
                        _ => return Err("变量后 '.' 需要字段名".into()),
                    }
                    // 深度 > 2 直接拒绝（白名单约束）
                    if let Some(Tok::Dot) = self.peek() {
                        return Err("变量路径深度超过 2（白名单限制：只支持 a 或 a.b）".into());
                    }
                }
                Ok(ExprNode::Var { base: id, field })
            }
            Some(Tok::LB) => {
                self.bump();
                let mut items = Vec::new();
                if !matches!(self.peek(), Some(Tok::RB)) {
                    loop {
                        let e = self.parse_or()?;
                        let v = eval_node(&e, &HashMap::new())?;
                        items.push(v);
                        match self.peek().cloned() {
                            Some(Tok::Comma) => {
                                self.bump();
                            }
                            Some(Tok::RB) => break,
                            _ => return Err("数组字面量缺少 ',' 或 ']'".into()),
                        }
                    }
                }
                self.bump();
                Ok(ExprNode::Lit(Value::Array(items)))
            }
            Some(t) => Err(format!("expr 解析错误：意外的 token {t:?}")),
            None => Err("expr 意外结束".into()),
        }
    }
}

fn eval_expr(s: &str, vars: &HashMap<String, Value>) -> Result<Value, String> {
    let toks = lex(s)?;
    let mut p = Parser { toks, pos: 0 };
    let node = p.parse_program()?;
    eval_node(&node, vars)
}

fn eval_node(node: &ExprNode, vars: &HashMap<String, Value>) -> Result<Value, String> {
    match node {
        ExprNode::Lit(v) => Ok(v.clone()),
        ExprNode::Paren(n) => eval_node(n, vars),
        ExprNode::Var { base, field } => {
            if base.contains(':') {
                let key = base.split_once(':').map(|(_, k)| k).unwrap_or(base);
                return Ok(Value::String(std::env::var(key).unwrap_or_default()));
            }
            let mut val = vars.get(base).cloned().unwrap_or(Value::Null);
            if let Some(f) = field {
                val = match &val {
                    Value::Object(m) => m.get(f).cloned().unwrap_or(Value::Null),
                    Value::Array(a) => {
                        if let Ok(idx) = f.parse::<usize>() {
                            a.get(idx).cloned().unwrap_or(Value::Null)
                        } else {
                            Value::Null
                        }
                    }
                    _ => Value::Null,
                };
            }
            Ok(val)
        }
        ExprNode::Unary { op, node } => {
            let v = eval_node(node, vars)?;
            match op.as_str() {
                "not" => Ok(Value::Bool(!truthy(&v))),
                other => Err(format!("未知一元运算符 {other}")),
            }
        }
        ExprNode::Binary { op, left, right } => {
            if op == "and" {
                let l = eval_node(left, vars)?;
                if !truthy(&l) {
                    return Ok(Value::Bool(false));
                }
                let r = eval_node(right, vars)?;
                return Ok(Value::Bool(truthy(&r)));
            }
            if op == "or" {
                let l = eval_node(left, vars)?;
                if truthy(&l) {
                    return Ok(Value::Bool(true));
                }
                let r = eval_node(right, vars)?;
                return Ok(Value::Bool(truthy(&r)));
            }
            let l = eval_node(left, vars)?;
            let r = eval_node(right, vars)?;
            match op.as_str() {
                "==" | "!=" => {
                    let eq = values_equal(&l, &r);
                    Ok(Value::Bool(if op == "==" { eq } else { !eq }))
                }
                ">" | ">=" | "<" | "<=" => eval_ord(&l, &r, op),
                "in" => match &r {
                    Value::Array(arr) => Ok(Value::Bool(arr.iter().any(|e| values_equal(e, &l)))),
                    _ => Err("in 运算符右侧必须是数组字面量".into()),
                },
                "matches" => {
                    let s = match &l {
                        Value::String(s) => s.clone(),
                        _ => return Err("matches 左侧必须是字符串".into()),
                    };
                    let pat = match &r {
                        Value::String(s) => s.clone(),
                        _ => return Err("matches 右侧必须是字符串".into()),
                    };
                    let re = Regex::new(&pat).map_err(|e| format!("正则错误: {e}"))?;
                    Ok(Value::Bool(re.is_match(&s)))
                }
                other => Err(format!("未知运算符 {other}")),
            }
        }
        ExprNode::Call { name, args } => eval_call(name, args, vars),
    }
}

fn eval_call(name: &str, args: &[ExprNode], vars: &HashMap<String, Value>) -> Result<Value, String> {
    match name {
        "len" | "count" | "exists" | "age_minutes" => {
            if args.len() != 1 {
                return Err(format!("{name} 需要 1 个参数"));
            }
            let v = eval_node(&args[0], vars)?;
            Ok(match name {
                "len" => Value::Number(num(len_of(&v) as f64)),
                "count" => Value::Number(num(if truthy(&v) {
                    if let Value::Array(a) = &v {
                        a.len()
                    } else {
                        1
                    }
                } else {
                    0
                } as f64)),
                "exists" => Value::Bool(truthy(&v)),
                "age_minutes" => {
                    let n = to_num(&v).unwrap_or(0.0);
                    let now = now_ms() as f64;
                    Value::Number(num(((now - n) / 60000.0).max(0.0)))
                }
                _ => Value::Null,
            })
        }
        "contains" => {
            if args.len() != 2 {
                return Err("contains 需要 2 个参数".into());
            }
            let c = eval_node(&args[0], vars)?;
            let item = eval_node(&args[1], vars)?;
            Ok(Value::Bool(contains_val(&c, &item)))
        }
        other => Err(format!("未知函数 {other}（白名单之外，拒绝执行）")),
    }
}

fn num(f: f64) -> serde_json::Number {
    serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0))
}

fn to_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        _ => {
            if let (Some(x), Some(y)) = (to_num(a), to_num(b)) {
                return (x - y).abs() < 1e-9;
            }
            if let (Value::String(x), Value::String(y)) = (a, b) {
                return x == y;
            }
            false
        }
    }
}

fn eval_ord(l: &Value, r: &Value, op: &str) -> Result<Value, String> {
    match (to_num(l), to_num(r)) {
        (Some(x), Some(y)) => Ok(Value::Bool(match op {
            ">" => x > y,
            ">=" => x >= y,
            "<" => x < y,
            "<=" => x <= y,
            _ => false,
        })),
        _ => Err(format!("无法对 {l} {op} {r} 做大小比较（需要数字）")),
    }
}

fn len_of(v: &Value) -> usize {
    match v {
        Value::String(s) => s.chars().count(),
        Value::Array(a) => a.len(),
        Value::Object(o) => o.len(),
        _ => 0,
    }
}

fn contains_val(container: &Value, item: &Value) -> bool {
    match container {
        Value::String(s) => match item {
            Value::String(sub) => s.contains(sub.as_str()),
            _ => false,
        },
        Value::Array(a) => a.iter().any(|e| values_equal(e, item)),
        Value::Object(o) => match item {
            Value::String(k) => o.contains_key(k),
            _ => false,
        },
        _ => false,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ───────────────────────────── 触发匹配（不联网） ─────────────────────────────

fn eval_condition(c: &Condition, ctx: &MatchContext) -> Result<bool, String> {
    if let Some(probe) = &c.probe {
        match ctx.probe_vars.get(probe) {
            Some(obj) => {
                let scope = flatten_top(obj);
                match &c.when {
                    Some(w) => eval_expr(w, &scope).map(|v| truthy(&v)),
                    None => Ok(true),
                }
            }
            None => Err(format!("缺少探针结果：{probe}（请先 run_probes）")),
        }
    } else if let Some(cmd) = &c.cmd {
        let expanded = registry::expand(&cmd.run, Some(&ctx.home));
        let (prog, base) = exec::split_shell("/bin/zsh -lc");
        let out = exec::run_blocking(prog, &base, &expanded, ".", &HashMap::new(), 15_000)
            .map_err(|e| format!("执行 cmd 触发失败: {e}"))?;
        let mut scope: HashMap<String, Value> = HashMap::new();
        scope.insert("exit".into(), Value::Number(num(out.code as f64)));
        scope.insert("out".into(), Value::String(out.combined.clone()));
        scope.insert("ok".into(), Value::Bool(out.code == 0));
        match &c.when {
            Some(w) => eval_expr(w, &scope).map(|v| truthy(&v)),
            None => {
                let mut ok = true;
                if let Some(ex) = cmd.expect_exit {
                    ok = ok && out.code == ex;
                }
                if let Some(pat) = &cmd.expect_output {
                    ok = ok && out.combined.contains(pat);
                }
                if let Some(pat) = &cmd.expect_not_output {
                    ok = ok && !out.combined.contains(pat);
                }
                Ok(ok)
            }
        }
    } else if c.log_match.is_some() {
        Err("log_match 需要实时日志流，V0.2 暂不支持".into())
    } else {
        Err("触发条件缺少 probe / cmd / log_match".into())
    }
}

pub fn match_playbooks(ctx: &MatchContext) -> Result<Vec<MatchedPlaybook>, String> {
    let books = load_playbooks()?;
    let mut out = Vec::new();
    for b in &books {
        let (triggers, mode_any) = if !b.trigger.any_of.is_empty() {
            (&b.trigger.any_of, true)
        } else {
            (&b.trigger.all_of, false)
        };

        if triggers.is_empty() {
            continue; // 空触发器只能手动触发，不进入自动匹配
        }

        let mut results: Vec<Result<bool, String>> = Vec::new();
        for c in triggers {
            results.push(eval_condition(c, ctx));
        }
        let combined = if mode_any {
            results.iter().any(|r| matches!(r, Ok(true)))
        } else {
            results.iter().all(|r| matches!(r, Ok(true)))
        };

        if combined {
            let notes = results
                .iter()
                .filter_map(|r| r.as_ref().err().cloned())
                .collect();
            out.push(MatchedPlaybook {
                id: b.id.clone(),
                title: b.title.clone(),
                service: b.service.clone(),
                severity: b.severity.clone(),
                category: b.category.clone(),
                symptom: b.symptom.clone(),
                trigger_summary: summarize_trigger(b),
                notes,
            });
        }
    }
    out.sort_by(|a, b| sev_rank(&b.severity).cmp(&sev_rank(&a.severity)));
    Ok(out)
}

fn sev_rank(s: &str) -> u8 {
    match s {
        "critical" => 0,
        "high" => 1,
        "warn" => 2,
        "info" => 3,
        _ => 4,
    }
}

fn summarize_trigger(b: &Playbook) -> String {
    let mut parts = Vec::new();
    for c in b.trigger.any_of.iter().chain(b.trigger.all_of.iter()) {
        if let Some(w) = &c.when {
            parts.push(w.clone());
        } else if let Some(p) = &c.probe {
            parts.push(format!("probe:{p}"));
        } else if c.cmd.is_some() {
            parts.push("cmd".into());
        } else if c.log_match.is_some() {
            parts.push("log_match".into());
        }
    }
    parts.join(" / ")
}

// ───────────────────────────── 只读诊断 + 结论推导 ─────────────────────────────

fn run_diagnose_step(
    step: &DiagnoseStep,
    vars: &mut HashMap<String, Value>,
    home: &str,
) -> Result<DiagnoseStepOut, String> {
    let mut ds = DiagnoseStepOut {
        id: step.id.clone(),
        title: step.title.clone(),
        cmd: None,
        output: String::new(),
        exit: 0,
        captured: None,
        error: None,
        optional: step.optional,
    };

    if let Some(exec_spec) = &step.exec {
        let cmd = registry::expand(&exec_spec.cmd, Some(home));
        let cwd = exec_spec
            .cwd
            .as_deref()
            .map(|c| registry::expand(c, Some(home)))
            .unwrap_or_else(|| home.to_string());
        let (prog, base) = exec::split_shell("/bin/zsh -lc");
        let out = exec::run_blocking(
            prog,
            &base,
            &cmd,
            &cwd,
            &HashMap::new(),
            exec_spec.timeout_ms.max(1000),
        )
        .map_err(|e| format!("执行失败: {e}"))?;
        ds.cmd = Some(cmd);
        ds.output = out.combined.clone();
        ds.exit = out.code;
        if !out.combined.trim().is_empty() {
            let cap = Value::String(out.combined.trim().to_string());
            ds.captured = Some(cap.clone());
            vars.insert(capture_name(step), cap);
        }
        Ok(ds)
    } else if let Some(sq) = &step.sqlite_query {
        let file = registry::expand(&sq.file, Some(home));
        let file_json =
            serde_json::to_string(&file).map_err(|e| format!("序列化路径失败: {e}"))?;
        let sql_json = serde_json::to_string(&sq.sql).map_err(|e| format!("序列化 SQL 失败: {e}"))?;
        let script = format!(
            "const {{DatabaseSync}}=require('node:sqlite');try{{const db=new DatabaseSync({},{{readOnly:true}});const rows=db.prepare({}).all();console.log('__LSH_SQL__'+JSON.stringify({{rows}}));}}catch(e){{console.log('__LSH_SQL_ERR__'+e.message);}}",
            file_json, sql_json
        );
        let out = exec::run_node_argv(&script, &[], home, 15_000)
            .map_err(|e| format!("运行 sqlite 查询失败: {e}"))?;
        let cap = if let Some(idx) = out.combined.find("__LSH_SQL__") {
            let js = &out.combined[idx + 11..];
            match serde_json::from_str::<Value>(js.trim()) {
                Ok(v) => v.get("rows").cloned().unwrap_or(Value::Array(vec![])),
                Err(_) => Value::String(js.to_string()),
            }
        } else if let Some(idx) = out.combined.find("__LSH_SQL_ERR__") {
            Value::String(format!("SQL 错误: {}", &out.combined[idx + 15..]))
        } else {
            Value::String(out.combined.clone())
        };
        ds.captured = Some(cap.clone());
        vars.insert(capture_name(step), cap);
        ds.output = out.combined.clone();
        Ok(ds)
    } else if let Some(rf) = &step.read_file {
        let path = registry::expand(rf, Some(home));
        let content = std::fs::read_to_string(&path).map_err(|e| format!("读取 {} 失败: {e}", path))?;
        let cap = Value::String(content.clone());
        ds.captured = Some(cap.clone());
        vars.insert(capture_name(step), cap);
        ds.output = format!("read {} ({} bytes)", path, content.len());
        Ok(ds)
    } else {
        Err("诊断步骤未声明 exec / sqlite_query / read_file".into())
    }
}

fn capture_name(step: &DiagnoseStep) -> String {
    step.capture.clone().unwrap_or_else(|| step.id.clone())
}

pub fn diagnose(pb: &Playbook) -> Result<DiagnoseResult, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut vars: HashMap<String, Value> = HashMap::new();
    let mut steps_out = Vec::new();
    let mut partial = false;

    // 1) 合并触发器里引用的探针变量（如 conclude 需用到的 live）
    for c in pb.trigger.any_of.iter().chain(pb.trigger.all_of.iter()) {
        if let Some(p) = &c.probe {
            if let Some((svc, probe)) = p.split_once('.') {
                if let Ok(obj) = run_probe(svc, probe) {
                    for (k, v) in flatten_top(&obj) {
                        vars.insert(k, v);
                    }
                }
            }
        }
    }

    // 2) 只读诊断步骤
    for step in &pb.diagnose {
        match run_diagnose_step(step, &mut vars, &home) {
            Ok(s) => steps_out.push(s),
            Err(e) => {
                if step.optional {
                    partial = true;
                    steps_out.push(DiagnoseStepOut {
                        id: step.id.clone(),
                        title: step.title.clone(),
                        cmd: None,
                        output: String::new(),
                        exit: 0,
                        captured: None,
                        error: Some(e),
                        optional: step.optional,
                    });
                } else {
                    return Err(format!("诊断步骤 {} 失败: {}", step.id, e));
                }
            }
        }
    }

    let conclusions = conclude(pb, &vars);
    let fix = fix_preview(pb);

    Ok(DiagnoseResult {
        id: pb.id.clone(),
        title: pb.title.clone(),
        severity: pb.severity.clone(),
        category: pb.category.clone(),
        symptom: pb.symptom.clone(),
        source: pb.source.clone(),
        steps: steps_out,
        vars: serde_json::to_value(&vars).unwrap_or(Value::Null),
        partial,
        conclusions,
        fix,
    })
}

fn conclude(pb: &Playbook, vars: &HashMap<String, Value>) -> Vec<ConclusionOut> {
    pb.conclude
        .iter()
        .map(|c| {
            let matched = eval_expr(&c.when, vars).map(|v| truthy(&v)).unwrap_or(false);
            ConclusionOut {
                when: c.when.clone(),
                root_cause: c.root_cause.clone(),
                confidence: c.confidence.clone(),
                evidence: c.evidence.clone(),
                recommended_fix: c.recommended_fix.clone(),
                matched,
            }
        })
        .collect()
}

fn yaml_value_to_string(v: &Option<serde_yaml::Value>) -> String {
    match v {
        Some(serde_yaml::Value::String(s)) => s.clone(),
        Some(other) => serde_yaml::to_string(other)
            .unwrap_or_default()
            .trim()
            .to_string(),
        None => String::new(),
    }
}

fn fix_preview(pb: &Playbook) -> Option<FixPreview> {
    let fix = pb.fix.as_ref()?;
    let mut steps = Vec::new();
    for s in &fix.steps {
        let command = match s.kind.as_str() {
            "exec" => s.cmd.clone().unwrap_or_default(),
            "sqlite_update" => format!("SQL: {}", s.sql.clone().unwrap_or_default()),
            "yaml_set" => format!(
                "设置 {} = {}",
                s.path.clone().unwrap_or_default(),
                yaml_value_to_string(&s.value)
            ),
            "file_write" => format!(
                "写入文件 {}: {}",
                s.file.clone().unwrap_or_default(),
                yaml_value_to_string(&s.value)
            ),
            "docker" => format!(
                "docker {} {}",
                s.action.clone().unwrap_or_default(),
                s.container.clone().unwrap_or_default()
            ),
            "launchctl" => format!(
                "launchctl {} {}",
                s.action.clone().unwrap_or_default(),
                s.label.clone().unwrap_or_default()
            ),
            "manual" => s.instruction.clone().unwrap_or_default(),
            _ => String::new(),
        };
        steps.push(FixStepPreview {
            id: s.id.clone(),
            title: s.title.clone().unwrap_or_default(),
            kind: s.kind.clone(),
            command,
            snapshot: s.snapshot,
        });
    }
    Some(FixPreview {
        mode: fix.mode.clone(),
        confirm: fix.confirm,
        risk: pb.risk.clone(),
        side_effects: pb.side_effects.clone(),
        requires_sudo: pb.requires_sudo,
        steps,
    })
}

// ───────────────────────────── V0.3 一键修复（assisted / auto） ─────────────────────────────

type StepRun = Result<(String, String, i32), String>; // (渲染命令, 输出, 退出码)

/// 执行一个修复步骤（只读诊断之外的"写"动作）。manual 步骤不执行，仅返回指引。
fn run_fix_step(step: &FixStep, home: &str, snapshots: &mut Vec<String>) -> FixStepOut {
    let mut out = FixStepOut {
        id: step.id.clone(),
        title: step.title.clone().unwrap_or_default(),
        kind: step.kind.clone(),
        command: String::new(),
        output: None,
        exit: None,
        error: None,
        skipped: false,
        skip_reason: None,
        rolled_back: false,
    };

    if step.kind == "manual" {
        out.skipped = true;
        out.skip_reason = Some(step.instruction.clone().unwrap_or_default());
        return out;
    }

    // 涉及文件的步骤执行前做快照（可回滚）
    if step.snapshot && (step.kind == "sqlite_update" || step.kind == "yaml_set" || step.kind == "file_write") {
        if let Some(f) = &step.file {
            let p = registry::expand(f, Some(home));
            if let Ok(s) = snapshot_file(&p) {
                snapshots.push(s);
            }
        }
    }

    let r: StepRun = match step.kind.as_str() {
        "exec" => run_fix_exec(step, home),
        "sqlite_update" => run_fix_sqlite(step, home),
        "yaml_set" => run_fix_yaml_set(step, home),
        "file_write" => run_fix_file_write(step, home),
        "docker" => run_fix_docker(step, home),
        "launchctl" => run_fix_launchctl(step, home),
        other => Err(format!("不支持的修复步骤类型: {other}")),
    };

    match r {
        Ok((cmd, output, exit)) => {
            out.command = cmd;
            out.output = Some(output);
            out.exit = Some(exit);
        }
        Err(e) => {
            out.error = Some(e);
        }
    }
    out
}

fn run_fix_exec(step: &FixStep, home: &str) -> StepRun {
    let cmd = registry::expand(step.cmd.as_deref().unwrap_or(""), Some(home));
    let cwd = step
        .cwd
        .as_deref()
        .map(|c| registry::expand(c, Some(home)))
        .unwrap_or_else(|| home.to_string());
    let (prog, base) = exec::split_shell("/bin/zsh -lc");
    let out = exec::run_blocking(prog, &base, &cmd, &cwd, &HashMap::new(), step.timeout_ms.max(1000))
        .map_err(|e| format!("执行失败: {e}"))?;
    Ok((cmd, out.combined.clone(), out.code))
}

fn run_fix_sqlite(step: &FixStep, home: &str) -> StepRun {
    let file = registry::expand(step.file.as_deref().unwrap_or(""), Some(home));
    let sql = step.sql.clone().unwrap_or_default();
    let file_json = serde_json::to_string(&file).map_err(|e| format!("序列化路径失败: {e}"))?;
    let sql_json = serde_json::to_string(&sql).map_err(|e| format!("序列化 SQL 失败: {e}"))?;
    let script = format!(
        "const {{DatabaseSync}}=require('node:sqlite');const db=new DatabaseSync({});const info=db.prepare({}).run();console.log('__LSH_SQL_OK__'+JSON.stringify({{changes:info.changes||0}}));",
        file_json, sql_json
    );
    let out = exec::run_node_argv(&script, &[], home, step.timeout_ms.max(1000))
        .map_err(|e| format!("运行 sqlite 更新失败: {e}"))?;
    let changes = if let Some(idx) = out.combined.find("__LSH_SQL_OK__") {
        let js = &out.combined[idx + 14..];
        serde_json::from_str::<Value>(js.trim())
            .ok()
            .and_then(|v| v.get("changes").and_then(|c| c.as_i64()))
            .unwrap_or(0)
    } else {
        0
    };
    Ok((format!("SQL: {sql}"), format!("已更新 {changes} 行"), out.code))
}

fn run_fix_yaml_set(step: &FixStep, home: &str) -> StepRun {
    let file = registry::expand(step.file.as_deref().unwrap_or(""), Some(home));
    let path = step.path.clone().unwrap_or_default();
    let content =
        std::fs::read_to_string(&file).map_err(|e| format!("读取 {} 失败: {e}", file))?;
    let mut doc: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("解析 YAML 失败: {e}"))?;
    set_yaml_path(&mut doc, &path, step.value.clone().unwrap_or(serde_yaml::Value::Null));
    let updated =
        serde_yaml::to_string(&doc).map_err(|e| format!("序列化 YAML 失败: {e}"))?;
    std::fs::write(&file, updated).map_err(|e| format!("写回 {} 失败: {e}", file))?;
    Ok((format!("设置 {path}"), format!("已写入 {file}"), 0))
}

fn run_fix_file_write(step: &FixStep, home: &str) -> StepRun {
    let file = registry::expand(step.file.as_deref().unwrap_or(""), Some(home));
    let content = yaml_value_to_string(&step.value);
    std::fs::write(&file, content.as_bytes()).map_err(|e| format!("写入 {} 失败: {e}", file))?;
    Ok((format!("写入 {file}"), "已写入".into(), 0))
}

fn run_fix_docker(step: &FixStep, home: &str) -> StepRun {
    let action = step.action.clone().unwrap_or_default();
    let container = step.container.clone().unwrap_or_default();
    let cmd = format!("docker {action} {container}");
    let (prog, base) = exec::split_shell("/bin/zsh -lc");
    let out = exec::run_blocking(prog, &base, &cmd, home, &HashMap::new(), step.timeout_ms.max(1000))
        .map_err(|e| format!("执行失败: {e}"))?;
    Ok((cmd, out.combined.clone(), out.code))
}

fn run_fix_launchctl(step: &FixStep, home: &str) -> StepRun {
    let action = step.action.clone().unwrap_or_default();
    let label = step.label.clone().unwrap_or_default();
    let full = if action == "kickstart" {
        format!("launchctl kickstart -k gui/{}/{}", current_uid(), label)
    } else {
        format!("launchctl {action} {label}")
    };
    let (prog, base) = exec::split_shell("/bin/zsh -lc");
    let out = exec::run_blocking(prog, &base, &full, home, &HashMap::new(), step.timeout_ms.max(1000))
        .map_err(|e| format!("执行失败: {e}"))?;
    Ok((full, out.combined.clone(), out.code))
}

fn current_uid() -> String {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// 沿点分路径设置 YAML 叶子值，中间节点缺失则补 Mapping。
fn set_yaml_path(doc: &mut serde_yaml::Value, path: &str, val: serde_yaml::Value) {
    let parts: Vec<&str> = path.split('.').collect();
    if parts.is_empty() {
        return;
    }
    let mut cur = doc;
    for p in &parts[..parts.len() - 1] {
        if !cur.is_mapping() {
            *cur = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
        }
        if let serde_yaml::Value::Mapping(m) = cur {
            let key = serde_yaml::Value::String((*p).to_string());
            if !m.contains_key(&key) {
                m.insert(key.clone(), serde_yaml::Value::Null);
            }
            cur = m.get_mut(&key).unwrap();
        } else {
            return;
        }
    }
    *cur = val;
}

fn snap_suffix() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn snapshot_file(path: &str) -> Result<String, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("快照目标不存在: {path}"));
    }
    let snap = format!("{path}.lsh-bak.{}", snap_suffix());
    std::fs::copy(path, &snap).map_err(|e| format!("快照失败: {e}"))?;
    Ok(snap)
}

fn restore_snapshot(snap: &str) -> Result<(), String> {
    let orig = snap.rsplit_once(".lsh-bak.").map(|(o, _)| o).unwrap_or(snap);
    std::fs::copy(snap, orig).map_err(|e| format!("恢复快照失败: {e}"))?;
    Ok(())
}

fn run_verify(pb: &Playbook, home: &str) -> Option<VerifyOut> {
    let v = pb.verify.as_ref()?;
    if let Some(probe) = &v.probe {
        if let Some((svc, p)) = probe.split_once('.') {
            return match run_probe(svc, p) {
                Ok(obj) => {
                    let mut vars = HashMap::new();
                    for (k, val) in flatten_top(&obj) {
                        vars.insert(k, val);
                    }
                    if let Some(expect) = &v.expect {
                        let ok = eval_expr(expect, &vars).map(|r| truthy(&r)).unwrap_or(false);
                        Some(VerifyOut {
                            passed: ok,
                            detail: if ok {
                                "探针复检通过".into()
                            } else {
                                format!("复检表达式未满足: {expect}")
                            },
                        })
                    } else {
                        Some(VerifyOut { passed: true, detail: "探针已复跑".into() })
                    }
                }
                Err(e) => Some(VerifyOut { passed: false, detail: format!("复检探针失败: {e}") }),
            };
        }
        return Some(VerifyOut { passed: false, detail: "verify.probe 格式应为 service.probeId".into() });
    }
    if let Some(cmd) = &v.cmd {
        let expanded = registry::expand(cmd, Some(home));
        let (prog, base) = exec::split_shell("/bin/zsh -lc");
        return match exec::run_blocking(prog, &base, &expanded, home, &HashMap::new(), v.timeout_ms) {
            Ok(out) => Some(VerifyOut { passed: out.code == 0, detail: out.combined.clone() }),
            Err(e) => Some(VerifyOut { passed: false, detail: format!("复检命令失败: {e}") }),
        };
    }
    None
}

/// V0.3 一键修复：诊断之后执行 fix 步骤，带快照回滚与复检。
/// confirmed=false 且 fix.confirm=true 时只返回 needs_confirm，不执行任何写动作。
pub fn apply_fix(pb: &Playbook, confirmed: bool) -> Result<FixApplyResult, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let fix = match &pb.fix {
        Some(f) => f,
        None => return Err("该剧本没有定义修复步骤".into()),
    };

    // 模式门：V0.2 强制只读，V0.3 仅执行 assisted / auto
    if fix.mode != "assisted" && fix.mode != "auto" {
        return Ok(FixApplyResult {
            executed: false,
            needs_confirm: false,
            rejected_sudo: false,
            mode: fix.mode.clone(),
            steps: Vec::new(),
            verify: None,
            rollback_note: Some("本剧本 fix.mode 为 manual，V0.3 仅展示命令、不代执行。".into()),
        });
    }

    // sudo 门：客户端绝不代执行需要 sudo 的步骤
    if pb.requires_sudo {
        return Ok(FixApplyResult {
            executed: false,
            needs_confirm: false,
            rejected_sudo: true,
            mode: fix.mode.clone(),
            steps: Vec::new(),
            verify: None,
            rollback_note: Some("requires_sudo=true，客户端不代执行，请按预览命令手动操作。".into()),
        });
    }

    // 确认门：fix.confirm=true 时必须 confirmed
    if fix.confirm && !confirmed {
        return Ok(FixApplyResult {
            executed: false,
            needs_confirm: true,
            rejected_sudo: false,
            mode: fix.mode.clone(),
            steps: Vec::new(),
            verify: None,
            rollback_note: None,
        });
    }

    // 先备份 fix.backup 列出的文件
    let mut backup_snaps: Vec<String> = Vec::new();
    for b in &fix.backup {
        let p = registry::expand(b, Some(&home));
        if let Ok(s) = snapshot_file(&p) {
            backup_snaps.push(s);
        }
    }

    let mut steps_out: Vec<FixStepOut> = Vec::new();
    let mut snapshots: Vec<String> = Vec::new();
    let mut failed = false;
    let mut failure_step: Option<String> = None;

    for step in &fix.steps {
        let out = run_fix_step(step, &home, &mut snapshots);
        let is_err = out.error.is_some();
        let skipped = out.skipped;
        steps_out.push(out);
        if is_err && !skipped {
            failed = true;
            failure_step = Some(step.id.clone());
            break;
        }
    }

    let verify = if !failed { run_verify(pb, &home) } else { None };

    // 复检不通过同样要回滚。
    //
    // 步骤全跑成功但复检没过，意味着"改动做完了，问题没解决"——
    // 服务会停在一个改过却更糟的中间态，比修之前还难排查。
    // 所以回滚的触发条件是「步骤失败 OR 复检失败」，而不只是前者。
    let verify_failed = matches!(&verify, Some(v) if !v.passed);

    let rollback_note = if failed {
        Some(rollback_all(
            pb,
            &home,
            &backup_snaps,
            &snapshots,
            &format!("步骤 {} 执行失败", failure_step.clone().unwrap_or_default()),
        ))
    } else if verify_failed {
        Some(rollback_all(pb, &home, &backup_snaps, &snapshots, "复检未通过"))
    } else {
        None
    };

    Ok(FixApplyResult {
        executed: !failed,
        needs_confirm: false,
        rejected_sudo: false,
        mode: fix.mode.clone(),
        steps: steps_out,
        verify,
        rollback_note,
    })
}

/// 把改动撤回：先还原所有快照，再执行剧本自己声明的 rollback 步骤。
/// 返回给用户看的一句话说明——回滚做了什么、原文件在哪，必须说得清。
fn rollback_all(
    pb: &Playbook,
    home: &str,
    backup_snaps: &[String],
    step_snaps: &[String],
    reason: &str,
) -> String {
    let mut restored = 0usize;
    for snap in backup_snaps.iter().chain(step_snaps.iter()) {
        if restore_snapshot(snap).is_ok() {
            restored += 1;
        }
    }

    let mut detail = vec![format!("{reason}，已还原 {restored} 个快照")];

    if let Some(rb) = &pb.rollback {
        for rs in &rb.steps {
            let mut dummy = Vec::new();
            let r = run_fix_step(rs, home, &mut dummy);
            detail.push(format!(
                "[rollback] {}: {}",
                rs.id,
                r.error
                    .clone()
                    .unwrap_or_else(|| r.output.clone().unwrap_or_default())
            ));
        }
        if let Some(note) = &rb.note {
            detail.push(note.clone());
        }
    }

    detail.join("；")
}

// ───────────────────────────── 测试 ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, Value)]) -> HashMap<String, Value> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), v.clone())).collect()
    }

    #[test]
    fn expr_comparisons_and_coercion() {
        // 数字比较
        let v = vars(&[("live", serde_json::json!(0)), ("total", serde_json::json!(8))]);
        assert!(truthy(&eval_expr("live == 0", &v).unwrap()));
        assert!(truthy(&eval_expr("total > 5", &v).unwrap()));
        assert!(truthy(&eval_expr("live != 1", &v).unwrap()));
        // 字符串 "0" 与数字 0 应判等（捕获量多为字符串）
        let v2 = vars(&[("proxy_listeners", Value::String("0".into()))]);
        assert!(truthy(&eval_expr("proxy_listeners == 0", &v2).unwrap()));
    }

    #[test]
    fn expr_logical_and_not_contains() {
        let v = vars(&[
            ("default_lang", Value::String("all".into())),
            ("results", serde_json::json!(0)),
        ]);
        assert!(truthy(
            &eval_expr("not contains(default_lang, 'en-US')", &v).unwrap()
        ));
        assert!(truthy(&eval_expr("results == 0", &v).unwrap()));
        // 短路：and 一侧 false
        assert!(!truthy(
            &eval_expr("false and results == 0", &v).unwrap()
        ));
    }

    #[test]
    fn expr_var_depth_limit_and_whitelist() {
        // 深度 2 允许
        let v = vars(&[("results", serde_json::json!({"count": 3}))]);
        assert!(truthy(&eval_expr("results.count == 3", &v).unwrap()));
        // 深度 3 必须拒绝
        assert!(eval_expr("a.b.c == 1", &v).is_err());
        // 未知函数必须拒绝（白名单之外 = 潜在后门）
        assert!(eval_expr("system('rm -rf /')", &v).is_err());
    }

    #[test]
    fn expr_functions() {
        let v = vars(&[("proxy_rows", Value::String("proxy_enabled=1".into()))]);
        assert!(truthy(&eval_expr("contains(proxy_rows, 'proxy_enabled')", &v).unwrap()));
        assert!(truthy(&eval_expr("len('hello') == 5", &v).unwrap()));
    }

    #[test]
    fn loader_parses_all_playbooks() {
        let books = load_playbooks().expect("加载剧本失败");
        // 仓库内置 13 个剧本
        assert_eq!(books.len(), 13, "应有 13 个剧本，实际 {:?}", books.len());
        // 关键剧本必须在
        for id in [
            "omniroute-ghost-proxy",
            "searxng-no-result",
            "host-frozen",
            "dsh-duplicate-loader",
        ] {
            assert!(books.iter().any(|b| b.id == id), "缺少剧本 {id}");
        }
    }

    #[test]
    fn matcher_uses_injected_probe_vars() {
        // 不联网：直接注入探针结果
        let mut probe_vars = HashMap::new();
        probe_vars.insert(
            "omniroute.providers-live".into(),
            serde_json::json!({"live": 0, "total": 35, "proxy_alive": false}),
        );
        probe_vars.insert(
            "searxng.search-returns-results".into(),
            serde_json::json!({"localized": true, "results": 3}),
        );
        let ctx = MatchContext {
            probe_vars,
            home: std::env::var("HOME").unwrap_or_default(),
        };
        let matched = match_playbooks(&ctx).expect("匹配失败");
        let ids: Vec<&str> = matched.iter().map(|m| m.id.as_str()).collect();
        assert!(
            ids.contains(&"omniroute-ghost-proxy"),
            "应匹配幽灵代理剧本，实际 {ids:?}"
        );
        assert!(
            ids.contains(&"searxng-no-result"),
            "应匹配 searxng 本地化剧本，实际 {ids:?}"
        );
    }

    #[test]
    fn apply_fix_requires_confirm_before_executing() {
        let pb = get_playbook("omniroute-ghost-proxy").expect("load");
        let r = apply_fix(&pb, false).expect("apply");
        assert!(!r.executed, "confirmed=false 不应执行任何写动作");
        assert!(r.needs_confirm, "assisted+confirm 应在 confirmed=false 时要求确认");
    }

    #[test]
    fn apply_fix_manual_mode_never_executes() {
        let pb = get_playbook("chromadb-empty-store").expect("load"); // mode: manual
        let r = apply_fix(&pb, true).expect("apply");
        assert!(!r.executed, "manual 模式即使 confirmed=true 也不执行");
    }

    #[test]
    fn apply_fix_sudo_is_rejected() {
        let yaml = r#"
schema: lsh.playbook/v1
id: test-sudo
title: t
trigger:
  any_of: []
diagnose:
  - id: d
    title: d
conclude:
  - when: "true"
    root_cause: r
fix:
  mode: assisted
  confirm: false
  steps: []
requires_sudo: true
"#;
        let pb: Playbook = serde_yaml::from_str(yaml).expect("parse");
        let r = apply_fix(&pb, true).expect("apply");
        assert!(r.rejected_sudo, "requires_sudo=true 必须被拒绝");
        assert!(!r.executed);
    }

    /// "步骤全成功但复检没过"必须回滚。
    ///
    /// 这是最容易被漏掉的一种坏结果：命令都跑通了，问题却没解决，
    /// 服务停在一个改过却更糟的中间态。不回滚的话，用户手上只剩一句
    /// "复检未通过"，却不知道系统已经被改成什么样了。
    #[test]
    fn verify_failure_triggers_rollback() {
        let yaml = r#"
schema: "lsh/playbook/v1"
id: lsh-test-verify-fail
title: 复检失败回滚测试
trigger:
  any_of: []
diagnose:
  - id: d
    title: d
    exec:
      cmd: "echo ok"
conclude:
  - when: "true"
    root_cause: 测试用
fix:
  mode: assisted
  confirm: false
  steps:
    - id: s1
      title: 做一处无害改动
      type: exec
      cmd: "echo changed"
      snapshot: false
verify:
  cmd: "false"
  timeout_ms: 5000
"#;
        let pb: Playbook = serde_yaml::from_str(yaml).expect("parse");
        let r = apply_fix(&pb, true).expect("apply");

        assert!(
            !r.verify.as_ref().map(|v| v.passed).unwrap_or(true),
            "verify 用 false 命令，必然不通过"
        );
        let note = r.rollback_note.clone().unwrap_or_default();
        assert!(
            note.contains("复检未通过"),
            "复检失败必须触发回滚并说明原因，实际 rollback_note: {note:?}"
        );
    }

    #[test]
    fn verify_success_does_not_roll_back() {
        let yaml = r#"
schema: "lsh/playbook/v1"
id: lsh-test-verify-ok
title: 复检通过测试
trigger:
  any_of: []
diagnose:
  - id: d
    title: d
    exec:
      cmd: "echo ok"
conclude:
  - when: "true"
    root_cause: 测试用
fix:
  mode: assisted
  confirm: false
  steps:
    - id: s1
      title: 做一处无害改动
      type: exec
      cmd: "echo changed"
      snapshot: false
verify:
  cmd: "true"
  timeout_ms: 5000
"#;
        let pb: Playbook = serde_yaml::from_str(yaml).expect("parse");
        let r = apply_fix(&pb, true).expect("apply");

        assert!(r.verify.as_ref().map(|v| v.passed).unwrap_or(false));
        assert!(
            r.rollback_note.is_none(),
            "复检通过就不该回滚，实际: {:?}",
            r.rollback_note
        );
    }

    /// 端到端：assisted + confirmed=true → 真实执行 echo 步骤，verify 通过，不触发回滚
    #[test]
    fn apply_fix_assisted_confirmed_executes_and_verifies() {
        let yaml = r#"
schema: "lsh/playbook/v1"
id: lsh-test-assisted-e2e
title: 一键修复端到端测试
trigger:
  any_of: []
diagnose:
  - id: d
    title: d
    exec:
      cmd: "echo diagnosing"
conclude:
  - when: "true"
    root_cause: 测试用
fix:
  mode: assisted
  confirm: false
  steps:
    - id: s1
      title: 执行无害命令
      type: exec
      cmd: "echo fixed"
      snapshot: false
verify:
  cmd: "true"
  timeout_ms: 5000
"#;
        let pb: Playbook = serde_yaml::from_str(yaml).expect("parse");
        let r = apply_fix(&pb, true).expect("apply");

        assert!(
            r.executed,
            "assisted+confirmed 应执行步骤，实际 executed=false"
        );
        assert!(
            !r.needs_confirm,
            "confirmed=true 不应要求二次确认"
        );
        assert!(
            !r.rejected_sudo,
            "不应拒绝 sudo（本测试不需要 sudo）"
        );
        assert!(
            r.verify.is_some(),
            "应执行 verify"
        );
        let verify = r.verify.as_ref().unwrap();
        assert!(
            verify.passed,
            "verify 用 true 命令应通过，实际: {:?}",
            verify
        );
        assert!(
            r.rollback_note.is_none(),
            "复检通过就不该回滚，实际 rollback_note: {:?}",
            r.rollback_note
        );
        // 检查步骤执行结果
        assert!(!r.steps.is_empty(), "应至少有 1 步执行记录");
        let first_step = &r.steps[0];
        assert_eq!(first_step.id, "s1");
        assert!(
            first_step.exit == Some(0),
            "echo fixed 应退出码 0，实际: {:?}",
            first_step.exit
        );
    }
}
