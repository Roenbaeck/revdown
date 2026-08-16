mod commands;
mod fullscreen;
mod mcp;

use commands::{
    export_review, load_sidecar, open_document, open_external, queue_associated_document,
    read_local_image, reload_source, restore_recent_document, save_sidecar, source_has_changed,
    take_pending_document, unwatch_source, watch_source, AppState,
};
use fullscreen::{
    handle_window_event, set_window_fullscreen, window_fullscreen_state, FullscreenState,
};
use mcp::{
    get_mcp_server_status, publish_mcp_snapshot, start_mcp_server, stop_mcp_server, McpServerState,
};
use std::{path::PathBuf, sync::Arc};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{Emitter, Manager};

const OPEN_DOCUMENT_EVENT: &str = "revdown-open-document";
const OPEN_PICKER_EVENT: &str = "revdown-open-picker";
const OPEN_MENU_ID: &str = "revdown-open";

fn focus_and_notify(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(OPEN_DOCUMENT_EVENT, ());
    }
}

fn queue_startup_document(app: &tauri::App) {
    let state = app.state::<AppState>();
    let current_directory = std::env::current_dir().ok();
    let mut queued = false;
    for argument in std::env::args_os().skip(1) {
        let path = PathBuf::from(argument);
        let path = if path.is_absolute() {
            path
        } else if let Some(directory) = &current_directory {
            directory.join(path)
        } else {
            path
        };
        queued |= queue_associated_document(&state, path);
    }
    if queued {
        focus_and_notify(app.handle());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .menu(|app| {
            let menu = Menu::default(app)?;
            let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open…", true, Some("CmdOrCtrl+O"))?;
            let separator = PredefinedMenuItem::separator(app)?;
            for item in menu.items()? {
                if let MenuItemKind::Submenu(submenu) = item {
                    if submenu.text()? == "File" {
                        submenu.prepend_items(&[&open, &separator])?;
                        break;
                    }
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == OPEN_MENU_ID {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit(OPEN_PICKER_EVENT, ());
                }
            }
        });

    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, cwd| {
        let state = app.state::<AppState>();
        let current_directory = PathBuf::from(cwd);
        let mut queued = false;
        for argument in arguments.into_iter().skip(1) {
            let path = PathBuf::from(argument);
            let path = if path.is_absolute() {
                path
            } else {
                current_directory.join(path)
            };
            queued |= queue_associated_document(&state, path);
        }
        if queued {
            focus_and_notify(app);
        }
    }));

    let app = builder
        .manage(AppState::default())
        .manage(Arc::new(FullscreenState::default()))
        .manage(Arc::new(McpServerState::default()))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            open_document,
            load_sidecar,
            save_sidecar,
            export_review,
            watch_source,
            unwatch_source,
            source_has_changed,
            reload_source,
            read_local_image,
            open_external,
            take_pending_document,
            restore_recent_document,
            set_window_fullscreen,
            window_fullscreen_state,
            start_mcp_server,
            stop_mcp_server,
            get_mcp_server_status,
            publish_mcp_snapshot
        ])
        .build(tauri::generate_context!())
        .expect("error while building Revdown");

    queue_startup_document(&app);
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let state = _app.state::<AppState>();
            let mut queued = false;
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    queued |= queue_associated_document(&state, path);
                }
            }
            if queued {
                focus_and_notify(_app);
            }
        }
    });
}
