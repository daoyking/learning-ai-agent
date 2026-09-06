//! detect.process 接线验证：端口的占用者必须是「我们」的进程。
//!
//! 背景：此前 `build_card` 只判断「声明的端口有没有人在听」，manifest 里的
//! `detect.process` 是从未被读取的**死配置**。2026-09-06 实测：8888 被
//! Unsloth Studio（python3.13）占着，而 AnythingLLM 应用根本没启动，
//! LSH 却把它标成「运行中」—— 正是这个工具要消灭的假活。
//!
//! 断言（都是硬不变量，不是快照）：
//!   1. 端口被不匹配的程序占着时，状态**绝不能**是 running
//!   2. 反过来，running 的服务不能同时带着 port_conflict
//!   3. 每个声明了 process 的服务，判定结果都要能被解释（打印出来人工核对）
//!
//! 运行：`cargo test --test detect_identity -- --nocapture`

use lsh_lib::commands;

#[test]
fn port_owner_must_be_our_process() {
    let scan = commands::scan_services().expect("scan_services 应成功");

    println!(
        "\n{:<12} {:<8} {:<10} {:<12} {}",
        "服务", "状态", "端口", "占用者", "判定"
    );
    println!("{}", "-".repeat(96));

    let mut violations = Vec::new();

    for card in &scan.services {
        let owner = scan
            .ports
            .iter()
            .find(|p| Some(p.port) == card.listening_port)
            .map(|p| p.command.clone())
            .unwrap_or_else(|| "—".to_string());

        let verdict = match (&card.port_conflict, card.status.as_str()) {
            (Some(c), _) => {
                let brief: String = c.command.chars().take(52).collect();
                format!("冲突：{} 被 {} (pid {}) 占着", c.port, brief, c.pid)
            }
            (None, "running") => format!("运行中（占用者 {}）", owner),
            (None, other) => format!("{}（无冲突）", other),
        };

        println!(
            "{:<12} {:<8} {:<10} {:<12} {}",
            card.id,
            card.status,
            card
                .listening_port
                .map(|p| p.to_string())
                .unwrap_or_else(|| "—".to_string()),
            owner,
            verdict
        );

        // 不变量 1：端口被别人占着就绝不能算运行中
        if card.port_conflict.is_some() && card.status == "running" {
            violations.push(format!(
                "{} 端口被别的进程占着，状态却是 running",
                card.id
            ));
        }
        // 不变量 2：运行中不能同时带着冲突标记
        if card.status == "running" && card.port_conflict.is_some() {
            violations.push(format!("{} 同时是 running 又有 port_conflict", card.id));
        }
    }

    println!("{}", "-".repeat(96));
    println!(
        "冲突 {} 个 · 运行中 {} 个",
        scan.services.iter().filter(|c| c.port_conflict.is_some()).count(),
        scan.services.iter().filter(|c| c.status == "running").count()
    );
    println!(
        "\n提示：如果某个服务「明明在跑」却被判成冲突，说明 manifest 的 detect.process\n\
         正则没覆盖它的真实命令行 —— 那是配置要改，不是把这条判定关掉。"
    );

    assert!(
        violations.is_empty(),
        "违反端口归属不变量：\n  - {}",
        violations.join("\n  - ")
    );
}
