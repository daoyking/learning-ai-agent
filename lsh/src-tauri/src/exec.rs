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

/// setsid 包装用的 perl 单行脚本。
///
/// 两个必须检查返回值的地方：
/// 1. setsid() —— 失败返回 -1。若调用进程已是进程组首进程就会 EPERM，
///    此时 exec 仍会成功，服务"看起来启动了"但没脱离会话。
/// 2. exec()   —— 程序不存在时返回 false，不检查的话 perl 会静默退出 0，
///    客户端会误报"已启动"。
///
/// 用 qq{} 而不是引号，避免和 shell / JSON / YAML 的多层转义打架。
const SETSID_SCRIPT: &str = concat!(
    "my $s = POSIX::setsid(); ",
    "die qq{LSH: setsid 失败 ($!)，服务将随客户端会话被回收\\n} if $s < 0; ",
    "exec @ARGV or die qq{LSH: exec 失败 ($!): $ARGV[0]\\n};"
);

/// 长任务的进程包装方式。
///
/// 这是五种 supervisor 能否真正拉起服务的分水岭：
/// - launchd / docker / app 都由外部守护或系统 API 接管，客户端只发命令，不需要包装；
/// - script 拉起的常驻进程（Odysseus / ChromaDB）若留在客户端的会话里，
///   客户端一退就可能被 SIGHUP 收走 —— 必须 setsid；
/// - pty 类程序（dsh）会校验 isatty()，没有伪终端直接崩。
#[derive(Debug, Clone, PartialEq)]
pub enum Wrap {
    None,
    /// macOS 没有 setsid 二进制，用 perl 的 POSIX::setsid 代替。
    Setsid,
    /// 用 macOS 自带的 /usr/bin/script 分配伪终端（零依赖，不必引入 portable-pty）。
    Pty { log: String, rows: u16, cols: u16 },
}

/// 拼出最终要 exec 的 (程序, 参数列表)。
///
/// 全程用 argv 数组传参，不拼 shell 字符串 —— 命令里带空格、引号、
/// 中文路径都不会被二次解析，也就没有注入面。
pub fn build_argv(shell: &str, cmd: &str, wrap: &Wrap) -> (String, Vec<String>) {
    let (prog, base) = split_shell(shell);
    let mut argv: Vec<String> = Vec::new();

    match wrap {
        Wrap::None => {
            argv.push(prog.to_string());
            argv.extend(base.iter().map(|s| s.to_string()));
        }
        Wrap::Setsid => {
            // perl -MPOSIX -e '<脚本>' <prog> <args…> <cmd>
            //
            // 脚本必须检查 setsid() 的返回值：它一旦失败（最常见的原因是调用者
            // 已经是进程组首进程），服务仍会照常启动，只是没脱离会话——
            // 客户端一退服务就没了。这种"看起来成功、实际没生效"的静默失败，
            // 正是本产品要消灭的假活，必须让它响亮地报错。
            argv.push("perl".into());
            argv.push("-MPOSIX".into());
            argv.push("-e".into());
            argv.push(SETSID_SCRIPT.into());
            argv.push(prog.to_string());
            argv.extend(base.iter().map(|s| s.to_string()));
        }
        Wrap::Pty { log, .. } => {
            // script -q <logfile> <prog> <args…> <cmd>
            argv.push("/usr/bin/script".into());
            argv.push("-q".into());
            argv.push(log.clone());
            argv.push(prog.to_string());
            argv.extend(base.iter().map(|s| s.to_string()));
        }
    }

    argv.push(cmd.to_string());
    (argv[0].clone(), argv[1..].to_vec())
}

/// pty 包装时要补的环境变量。程序通过 ioctl 拿不到就退回读这两个变量。
pub fn pty_env(rows: u16, cols: u16) -> Vec<(String, String)> {
    vec![
        ("COLUMNS".into(), cols.to_string()),
        ("LINES".into(), rows.to_string()),
    ]
}

/// 确保 pty 日志的父目录存在 —— script 不会自己建目录，
/// 路径不存在时会直接失败，且报错信息很难看懂。
pub fn ensure_parent_dir(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建日志目录 {} 失败: {e}", parent.display()))?;
        }
    }
    Ok(())
}

/// 后台拉起长任务（start/restart）。脱离进程组，stdio 丢弃，立即返回 pid。
/// 包装方式由 wrap 决定，见 build_argv。
///
/// 返回的是「最外层包装进程」的 pid（perl 或 script）。setsid / pty 场景下
/// 它 exec 后就变成目标进程本身，所以 pid 依然是有效的服务进程号。
pub fn spawn_detached(
    prog: &str,
    base_args: &[&str],
    cmd: &str,
    cwd: &str,
    env: &HashMap<String, String>,
    wrap: &Wrap,
) -> Result<u32, String> {
    let (real_prog, args) = build_argv(&rejoin_shell(prog, base_args), cmd, wrap);
    // setsid 自己会创建新会话 + 新进程组，不能再提前 setpgid ——
    // 否则 perl 成为进程组首进程，setsid() 触发 EPERM 直接失败。
    let use_process_group = !matches!(wrap, Wrap::Setsid);
    spawn_argv(&real_prog, &args, cwd, env, use_process_group)
}

/// 把 (prog, base_args) 还原成 build_argv 认识的 "prog -l -c" 形态。
fn rejoin_shell(prog: &str, base_args: &[&str]) -> String {
    if base_args.is_empty() {
        prog.to_string()
    } else {
        format!("{prog} {}", base_args.join(" "))
    }
}

/// argv 版的 detached 拉起：真正的执行入口。
///
/// `use_process_group=false` 时必须保证 argv 里已经有 setsid 包装，
/// 否则子进程会留在客户端的进程组里。
pub fn spawn_argv(
    prog: &str,
    args: &[String],
    cwd: &str,
    env: &HashMap<String, String>,
    use_process_group: bool,
) -> Result<u32, String> {
    let mut command = Command::new(prog);
    command
        .args(args)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.clone(), v.clone())))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // 新进程组：客户端退出时不会把服务一起带走。
    //
    // 但 setsid 包装下必须关掉：setpgid(0,0) 会让子进程成为进程组首进程，
    // 而 setsid() 对进程组首进程调用会返回 EPERM —— 两者互斥，只能取其一。
    // setsid 本身已经同时完成了"新会话 + 新进程组"两件事，是更强的保证。
    if use_process_group {
        command.process_group(0);
    }

    let child = command.spawn().map_err(|e| format!("启动失败: {e}"))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_without_wrap_is_plain_shell() {
        // 注意 -lc 是一个整体 token（shell 串按空白切分，不拆短选项）
        let (prog, args) = build_argv("/bin/zsh -lc", "echo hi", &Wrap::None);
        assert_eq!(prog, "/bin/zsh");
        assert_eq!(args, vec!["-lc", "echo hi"]);
    }

    #[test]
    fn argv_setsid_prepends_perl_posix() {
        // macOS 没有 setsid 二进制，只能用 perl 的 POSIX::setsid。
        // 这条断言保证不会有人"顺手改回" setsid 导致命令找不到。
        let (prog, args) = build_argv("/bin/bash -lc", "./start.sh", &Wrap::Setsid);
        assert_eq!(prog, "perl");
        assert_eq!(args[0], "-MPOSIX");
        assert_eq!(args[1], "-e");
        assert_eq!(args[2], SETSID_SCRIPT);
        assert_eq!(args[3], "/bin/bash");
        assert_eq!(args[4], "-lc");
        assert_eq!(args[5], "./start.sh");
        assert_eq!(args.len(), 6, "不应有多余参数: {args:?}");
    }

    #[test]
    fn argv_pty_prepends_bsd_script() {
        let (prog, args) = build_argv(
            "/bin/zsh -lc",
            "dsh web",
            &Wrap::Pty {
                log: "/tmp/x.log".into(),
                rows: 50,
                cols: 200,
            },
        );
        assert_eq!(prog, "/usr/bin/script");
        assert_eq!(args[0], "-q");
        assert_eq!(args[1], "/tmp/x.log");
        assert_eq!(args[2], "/bin/zsh");
        assert_eq!(args[3], "-lc");
        assert_eq!(args[4], "dsh web");
        assert_eq!(args.len(), 5, "不应有多余参数: {args:?}");
    }

    #[test]
    fn pty_env_exposes_terminal_size() {
        let env = pty_env(50, 200);
        assert!(env.contains(&("COLUMNS".into(), "200".into())));
        assert!(env.contains(&("LINES".into(), "50".into())));
    }

    #[test]
    fn setsid_script_runs_target_successfully() {
        use std::process::Command;
        let (prog, args) = build_argv("/bin/sh -c", "echo LSH_OK", &Wrap::Setsid);
        let out = Command::new(prog)
            .args(&args)
            .output()
            .expect("perl 应可用");
        assert!(
            out.status.success(),
            "setsid 包装后目标命令应正常执行，stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "LSH_OK");
    }

    #[test]
    fn setsid_failure_is_loud_not_silent() {
        use std::process::Command;

        // 这条测试守的是一个真实踩过的坑：
        // setpgid(0,0) 让进程成为进程组首进程后，setsid() 会返回 EPERM。
        // 早期版本忽略返回值直接 exec，结果服务"启动成功"了却还留在客户端
        // 会话里 —— 客户端一退服务跟着没，且从 UI 上完全看不出来。
        //
        // 这里的断言是：失败必须报错并拒绝启动，绝不静默继续。
        let outer = format!(
            "POSIX::setpgid(0,0); exec 'perl', '-MPOSIX', '-e', '{}', '/bin/echo', 'SHOULD_NOT_RUN';",
            SETSID_SCRIPT
        );
        let out = Command::new("perl")
            .args(["-MPOSIX", "-e", &outer])
            .output()
            .expect("perl 应可用");

        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success(),
            "setsid 失败时脚本必须非零退出，实际 stdout: {}",
            String::from_utf8_lossy(&out.stdout)
        );
        assert!(
            stderr.contains("LSH: setsid"),
            "应给出可读的失败原因，实际 stderr: {stderr}"
        );
        assert!(
            !String::from_utf8_lossy(&out.stdout).contains("SHOULD_NOT_RUN"),
            "setsid 失败就不该继续拉起服务——否则用户会以为启动成功了"
        );
    }

    #[test]
    fn ensure_parent_dir_creates_nested_dirs() {
        let dir = std::env::temp_dir().join("lsh-test-pty-deep");
        let _ = std::fs::remove_dir_all(&dir);
        let log = dir.join("nested").join("a.log");
        ensure_parent_dir(&log.to_string_lossy()).expect("应创建成功");
        assert!(log.parent().unwrap().is_dir());
        // 只建目录，不建文件
        assert!(!log.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
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
