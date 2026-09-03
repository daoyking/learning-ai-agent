//! 真机联调（real-machine integration test）
//!
//! 不依赖任何 mock：直接调用与 Tauri 命令完全相同的后端函数，
//! 对**本机真实运行的服务**跑完整管线：
//!
//!   扫描真实端口 → 跑真实 L3 语义探针 → 白名单表达式匹配剧本
//!   → 对命中的剧本做只读诊断（重跑探针 + 采集证据链 + 推导根因）
//!
//! 运行：`cargo test --test real_machine -- --nocapture`
//! （普通 `cargo test` 不会自动跑它——它属于 integration test target，
//!  需显式 `--test real_machine`，避免每次单测都去打真实服务。）

use std::collections::HashMap;
use std::time::Instant;

use lsh_lib::commands;
use lsh_lib::pb;
use serde_json::Value;

#[test]
fn real_machine_pipeline() {
    println!("\n──────────────────────── 真机联调 · LSH 后端管线 ────────────────────────");

    // ① 扫描真实监听端口（lsof，无网络）
    let t0 = Instant::now();
    let scan = commands::scan_services().expect("scan_services 应成功");
    let scan_ms = t0.elapsed().as_millis();
    println!(
        "[1] scan_services: {} 个服务声明、{} 个真实监听端口（{scan_ms}ms）",
        scan.services.len(),
        scan.ports.len()
    );
    let knowns: [u16; 6] = [11434, 20128, 7001, 8081, 8100, 3001];
    let found: Vec<u16> = knowns
        .iter()
        .copied()
        .filter(|p| scan.ports.iter().any(|e| e.port == *p))
        .collect();
    println!(
        "    关键本地 AI 服务端口探测：已知 {:?} → 本机在听 {:?}",
        knowns, found
    );
    assert!(
        !scan.ports.is_empty(),
        "本机应有真实监听端口；若为空说明 lsof 不可用或被沙箱限制"
    );

    // ② 跑真实 L3 语义探针（对 localhost 上真实运行的服务）
    let t1 = Instant::now();
    let runs = pb::run_all_probes().expect("run_all_probes 应成功");
    let probe_ms = t1.elapsed().as_millis();
    let ok_count = runs.iter().filter(|r| r.ok).count();
    println!(
        "\n[2] run_all_probes: {} 个探针、{} 成功（{probe_ms}ms）",
        runs.len(),
        ok_count
    );
    for r in &runs {
        let tag = if r.ok { "✓" } else { "✗" };
        println!(
            "    {tag} {}.{}",
            r.service, r.probe
        );
    }

    // ③ 把探针结果喂进匹配上下文（key = "service.probeId"）
    let mut probe_vars: HashMap<String, Value> = HashMap::new();
    for r in &runs {
        probe_vars.insert(format!("{}.{}", r.service, r.probe), r.vars.clone());
    }
    assert!(
        !probe_vars.is_empty(),
        "探针应有输出；若为空说明 node 探针脚本全部执行失败"
    );

    // ④ 白名单表达式匹配（不联网，仅用已注入的探针变量求值触发器）
    let ctx = pb::MatchContext {
        probe_vars,
        home: std::env::var("HOME").unwrap_or_default(),
    };
    let matched = pb::match_playbooks(&ctx).expect("match_playbooks 应成功");
    println!(
        "\n[3] match_playbooks: 13 个剧本中命中 {} 个",
        matched.len()
    );
    for m in &matched {
        println!(
            "    ⚑ [{}] {}  —  {}\n       触发：{}",
            m.severity, m.title, m.id, m.trigger_summary
        );
    }

    // ⑤ 对命中的剧本做只读诊断：重跑触发探针 + 采集证据链 + 推导根因 + 给出修复预览
    println!("\n[4] 对命中剧本做只读诊断（diagnose，不改任何东西）：");
    for m in &matched {
        let pb_ok = match pb::get_playbook(&m.id) {
            Ok(p) => p,
            Err(e) => {
                println!("    · {} 取剧本失败：{e}", m.id);
                continue;
            }
        };
        match pb::diagnose(&pb_ok) {
            Ok(d) => {
                let concl = d
                    .conclusions
                    .iter()
                    .map(|c| format!("[{}] {}", c.confidence, c.root_cause))
                    .collect::<Vec<_>>()
                    .join("；");
                println!(
                    "    · [{}] {} → 结论：{}",
                    d.severity,
                    d.title,
                    if concl.is_empty() {
                        "（无结论）".into()
                    } else {
                        concl
                    }
                );
                if let Some(fix) = &d.fix {
                    println!(
                        "      修复预览({} · risk={}): {} 步",
                        fix.mode,
                        fix.risk,
                        fix.steps.len()
                    );
                }
                if d.partial {
                    println!("      ⚠ 部分诊断（有可选步骤跳过的）");
                }
            }
            Err(e) => println!("    · {} 诊断出错：{e}", m.id),
        }
    }

    println!("\n──────────────────────── 真机联调通过：完整管线在真实机器上跑通 ────────────────────────\n");
}
