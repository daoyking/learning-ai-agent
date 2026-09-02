//! 命令执行原语：限时阻塞执行 + 后台 detached 拉起。
//! commands 与 pb（playbook 引擎）共用，避免两份逻辑漂移。

use std::collections::HashMap;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// 把 "shell -lc" 这样的串拆成 (程序, [参数…])
pub fn split_shell(shell: &str) -> (&str, Vec<&str>) {
    let parts: Vec<&str> = shell.split_whitespace().collect();
    match parts.split_first() {
        Some((prog, rest)) => (*prog, rest.to_vec()),
        None => ("/bin/sh", vec!["-c"]),
    }
}

/// 后台拉起长任务（start/restart）。脱离进程组，stdio 丢弃，立即返回 pid。
pub fn spawn_detached(
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
    command.process_group(0);

    let child = command
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(child.id())
}

pub struct BlockOutcome {
    pub code: i32,
    pub combined: String,
    pub timed_out: bool,
}

/// 限时执行短命令，捕获合并后的 stdout+stderr。
pub fn run_blocking(
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

/// 用 node -e 跑一段只读脚本（probe / sqlite 查询等）。
/// 通过 argv 传参，避免把外部字符串拼进 shell。
pub fn run_node_argv(
    script: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: u64,
) -> Result<BlockOutcome, String> {
    let mut command = Command::new("node");
    command
        .arg("-e")
        .arg(script)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 node 失败: {e}"))?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1000));
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("等待 node 失败: {e}")),
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("读取 node 输出失败: {e}"))?;
    Ok(BlockOutcome {
        code: out.status.code().unwrap_or(-1),
        combined: String::from_utf8_lossy(&out.stdout).to_string(),
        timed_out,
    })
}
