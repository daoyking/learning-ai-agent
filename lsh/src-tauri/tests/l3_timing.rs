//! L3 探针耗时剖析（profiling）。
//!
//! 用途：L3 是本项目的核心，但它很贵（真发请求、真跑推理、冷启动 CLI）。
//! 每次调整探针或 manifest 超时后跑一遍，看清楚钱花在哪、有没有探针在
//! 被超时砍掉（耗时≈声明的 timeout_ms 就是被砍了，属故障而非慢）。
//!
//! 运行：`cargo test --test l3_timing -- --nocapture`
//! （与 real_machine.rs 一样不会随普通 `cargo test` 自动跑。）

use std::time::Instant;

#[test]
fn l3_timing() {
    let t0 = Instant::now();
    let runs = lsh_lib::pb::run_all_probes().expect("run_all_probes 应成功");
    let wall = t0.elapsed().as_millis();

    println!(
        "\n{:<34} {:<6} {:>8}  {}",
        "探针", "结果", "ms", "摘要"
    );
    println!("{}", "-".repeat(104));

    let mut sum = 0u128;
    for r in &runs {
        sum += r.ms as u128;
        let brief = if r.ok {
            "OK".to_string()
        } else {
            let e = r
                .vars
                .get("error")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| r.raw.clone());
            e.chars().take(64).collect()
        };
        println!(
            "{:<34} {:<6} {:>8}  {}",
            format!("{}.{}", r.service, r.probe),
            if r.ok { "✓" } else { "✗" },
            r.ms,
            brief
        );
    }

    println!("{}", "-".repeat(104));
    println!(
        "墙钟 {wall}ms · 探针耗时合计 {sum}ms · 并发收益 {:.1}x · {} 个探针 · 通过 {}",
        sum as f64 / wall.max(1) as f64,
        runs.len(),
        runs.iter().filter(|r| r.ok).count()
    );
    println!(
        "提示：若某探针耗时≈其 manifest 的 timeout_ms，说明它被超时砍了，\
         输出为空 → 表现为「输出非 JSON」假失败，需上调 timeout_ms。"
    );
}
