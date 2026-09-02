mod commands;
mod model;
mod registry;
mod scanner;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_services,
            commands::scan_ports,
            commands::list_services,
            commands::preview_action,
        ])
        .run(tauri::generate_context!())
        .expect("启动 LocalServiceHub 失败");
}
