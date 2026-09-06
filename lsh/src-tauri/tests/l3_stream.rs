//! L3 流式进度回调验证（V0.9）。
//!
//! 流式体检的核心契约有三条，任何一条破了前端都会显示错的东西：
//!   1. 每个探针**恰好**回调一次 —— 漏一条进度就永远停在 13/14
//!   2. `done` 从 1 递增到 total、total 恒定 —— 否则进度条会跳
//!   3. 回调顺序可以是完成顺序（乱序），但**返回值必须是声明顺序** ——
//!      否则每次体检卡片顺序都在变，用户没法横向对比
//!
//! 另外这条测试本身就是「不死锁」的回归测试：探针 panic 时若漏发消息，
//! 收集端会一直阻塞在 recv 上，测试直接超时挂死而不是静默通过。
//!
//! 运行：`cargo test --test l3_stream -- --nocapture`
//! （与 real_machine.rs 一样不会随普通 `cargo test` 自动跑。）

use std::sync::Mutex;
use std::time::Instant;

#[test]
fn l3_stream_reports_every_probe() {
    // 声明顺序（manifest 顺序）作为期望值
    let expected: Vec<String> = lsh_lib::registry::load_manifests()
        .expect("应能加载 manifests")
        .iter()
        .flat_map(|m| {
            m.health
                .l3
                .iter()
                .map(move |p| format!("{}.{}", m.id, p.id))
        })
        .collect();

    // 回调在**调用线程**上执行，但用 Mutex 保险（也顺带证明它没被要求 Sync）
    let seen: Mutex<Vec<(usize, usize, String)>> = Mutex::new(Vec::new());

    let t0 = Instant::now();
    let runs = lsh_lib::pb::run_all_probes_with(Some(&|done, total, run| {
        seen.lock()
            .unwrap()
            .push((done, total, format!("{}.{}", run.service, run.probe)));
    }))
    .expect("run_all_probes_with 应成功");
    let wall = t0.elapsed().as_millis();

    let seen = seen.into_inner().unwrap();

    println!("\n{:<4} {:<34} {}", "done", "回调顺序（完成顺序）", "ok");
    println!("{}", "-".repeat(60));
    for (done, _, name) in &seen {
        let ok = runs.iter().any(|r| format!("{}.{}", r.service, r.probe) == *name && r.ok);
        println!("{:<4} {:<34} {}", done, name, if ok { "✓" } else { "✗" });
    }
    println!("{}", "-".repeat(60));
    println!("墙钟 {wall}ms · 探针 {}/{} 个 · 回调 {} 次", runs.len(), expected.len(), seen.len());

    // 契约 1+2：次数与递增
    assert_eq!(
        seen.len(),
        expected.len(),
        "每个探针都应回调恰好一次，实际回调 {} 次、探针 {} 个",
        seen.len(),
        expected.len()
    );
    for (i, (done, total, _)) in seen.iter().enumerate() {
        assert_eq!(*done, i + 1, "done 应从 1 逐个递增");
        assert_eq!(*total, expected.len(), "total 应恒为探针总数");
    }

    // 契约 3：返回值是声明顺序
    let got: Vec<String> = runs
        .iter()
        .map(|r| format!("{}.{}", r.service, r.probe))
        .collect();
    assert_eq!(got, expected, "返回值顺序必须与 manifest 声明顺序一致");

    // 回调顺序若与声明顺序不同，说明并发确实生效了（不是退化成串行）
    let streamed: Vec<String> = seen.iter().map(|(_, _, n)| n.clone()).collect();
    println!(
        "回调顺序{}声明顺序（并发{}）",
        if streamed == expected { "==" } else { "!=" },
        if streamed == expected { "未生效/探针刚好等速" } else { "生效" }
    );
}
