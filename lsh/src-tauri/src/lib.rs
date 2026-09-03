mod commands;
mod doctor;
mod exec;
mod logs;
mod model;
mod pb;
mod registry;
mod scanner;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_services,
            commands::scan_ports,
            commands::list_services,
            commands::preview_action,
            commands::run_action,
            commands::list_playbooks,
            commands::match_playbooks,
            commands::diagnose_playbook,
            commands::run_probes,
            commands::list_log_sources,
            commands::tail_logs,
            commands::rotate_log,
            commands::run_doctor,
            commands::apply_fix,
            commands::update_tray_status,
        ])
        .setup(|app| {
            // 托盘常驻：菜单（显示 / 运行体检 / 退出）+ 状态 tooltip。
            // 窗口关闭不退出，而是隐藏，使客户端常驻后台。
            let menu = Menu::new(app)?;
            let show = MenuItem::with_id(app, "show", "显示 Hub", true, None::<&str>)?;
            let doctor = MenuItem::with_id(app, "doctor", "运行体检", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            menu.append(&show)?;
            menu.append(&doctor)?;
            menu.append(&quit)?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("缺少窗口图标");
            TrayIconBuilder::with_id("lsh-tray")
                .icon(icon)
                .tooltip("Local Service Hub — 本机 AI 服务控制中心")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "doctor" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        // 真正跑体检由前端在「体检」标签页完成；这里只负责把窗口唤到前台。
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 LocalServiceHub 失败");
}
