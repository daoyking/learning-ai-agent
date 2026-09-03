use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// 一个服务的声明式描述，对应 manifests/schema/service-manifest.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceManifest {
    pub schema: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub category: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub home: Option<String>,
    #[serde(default)]
    pub version_range: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub detect: Detect,
    pub supervisor: Supervisor,
    #[serde(default)]
    pub health: Health,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub provides: Vec<String>,
    #[serde(default)]
    pub config: Config,
    #[serde(default)]
    pub logs: Vec<LogSource>,
    #[serde(default)]
    pub playbooks: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub danger: Danger,
}

fn default_priority() -> String {
    "P1".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Detect {
    #[serde(default)]
    pub ports: Vec<u16>,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub launchd: Vec<String>,
    #[serde(default)]
    pub docker: Vec<String>,
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Supervisor {
    /// launchd | docker | app | script | pty
    pub kind: String,
    #[serde(default)]
    pub label: Option<String>,
    /// [launchd] plist 路径。job 未加载时 bootstrap 必须要它，光有 label 不够。
    #[serde(default)]
    pub plist: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub app: Option<String>,
    #[serde(default)]
    pub detach: Option<String>,
    #[serde(default)]
    pub pty: Option<PtySpec>,
    #[serde(default)]
    pub note: Option<String>,
    /// 如何判断服务是否处于"被监管"状态。
    /// 运行中但无人监管 = 崩了没人拉起，是一等风险信号，必须在 UI 上和"停机"区分开。
    #[serde(default)]
    pub supervision: Supervision,
    #[serde(default)]
    pub actions: HashMap<String, Action>,
}

/// 监管状态判定方式。check=none 表示不做判定（如纯 GUI 应用）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Supervision {
    #[serde(default = "default_supervision_check")]
    pub check: String,
    #[serde(default)]
    pub expect: Option<String>,
}

fn default_supervision_check() -> String { "none".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PtySpec {
    pub cmd: String,
    #[serde(default)]
    pub log: Option<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_true")]
    pub hold: bool,
    /// script = macOS 自带 /usr/bin/script（零依赖，推荐）
    /// portable-pty = 需要交互式写入时才用
    #[serde(default = "default_wrapper")]
    pub wrapper: String,
}

fn default_rows() -> u16 { 50 }
fn default_cols() -> u16 { 200 }
fn default_true() -> bool { true }
fn default_wrapper() -> String { "script".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    #[serde(default)]
    pub cmd: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub danger: Option<String>,
    #[serde(default)]
    pub sudo: bool,
    #[serde(default)]
    pub note: Option<String>,
    /// 前置条件表达式，如 "supervised == true"。
    /// 不满足时执行 fallback_action，而不是直接报"启动失败"——
    /// 后者会让人误以为服务坏了，实际只是没注册。
    #[serde(default)]
    pub precondition: Option<String>,
    #[serde(default)]
    pub fallback_action: Option<String>,
    /// 进程包装方式，仅对长任务（start/restart）有意义：
    ///   setsid = perl POSIX::setsid 脱离会话（macOS 无 setsid 二进制）
    ///   pty    = /usr/bin/script -q 分配伪终端（dsh 这类校验 TTY 的程序）
    /// 不写时由 supervisor 的 detach / pty 推导，见 commands::derive_wrap。
    #[serde(default)]
    pub wrap: Option<String>,
}

fn default_shell() -> String { "/bin/zsh -lc".into() }
fn default_timeout() -> u64 { 30_000 }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Health {
    #[serde(default)]
    pub l1: Option<ProbeL1>,
    #[serde(default)]
    pub l2: Option<ProbeL2>,
    #[serde(default)]
    pub l3: Vec<ProbeL3>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeL1 {
    #[serde(default = "default_tcp")]
    pub r#type: String,
    #[serde(default = "default_host")]
    pub host: String,
    pub port: u16,
    #[serde(default = "default_l1_timeout")]
    pub timeout_ms: u64,
}

fn default_tcp() -> String { "tcp".into() }
fn default_host() -> String { "127.0.0.1".into() }
fn default_l1_timeout() -> u64 { 2_000 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeL2 {
    #[serde(default = "default_http")]
    pub r#type: String,
    pub url: String,
    #[serde(default = "default_get")]
    pub method: String,
    #[serde(default = "default_200")]
    pub expect_status: u16,
    #[serde(default)]
    pub expect_body: Option<String>,
    #[serde(default = "default_l2_timeout")]
    pub timeout_ms: u64,
}

fn default_http() -> String { "http".into() }
fn default_get() -> String { "GET".into() }
fn default_200() -> u16 { 200 }
fn default_l2_timeout() -> u64 { 5_000 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeL3 {
    pub id: String,
    #[serde(default)]
    pub desc: Option<String>,
    #[serde(default = "default_http_json")]
    pub r#type: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default = "default_get")]
    pub method: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(default)]
    pub jq: Option<String>,
    #[serde(default)]
    pub assert: Option<String>,
    #[serde(default)]
    pub script: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub exec: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "default_l3_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_l3_interval")]
    pub interval_ms: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_free")]
    pub cost: String,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_http_json() -> String { "http_json".into() }
fn default_l3_timeout() -> u64 { 15_000 }
fn default_l3_interval() -> u64 { 300_000 }
fn default_free() -> String { "free".into() }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub sqlite: Vec<SqliteSpec>,
    #[serde(default)]
    pub plist: Vec<String>,
    #[serde(default)]
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SqliteSpec {
    pub path: String,
    #[serde(default)]
    pub tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogSource {
    pub kind: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub rotate: Option<RotateSpec>,
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RotateSpec {
    #[serde(default = "default_max_size")]
    pub max_size: String,
    #[serde(default = "default_keep")]
    pub keep: u8,
    #[serde(default = "default_strategy")]
    pub strategy: String,
}

fn default_max_size() -> String { "20MB".into() }
fn default_keep() -> u8 { 3 }
fn default_strategy() -> String { "copytruncate".into() }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Danger {
    #[serde(default)]
    pub stop_requires_confirm: bool,
    #[serde(default)]
    pub impact: Option<String>,
}
