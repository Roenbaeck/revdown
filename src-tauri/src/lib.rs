mod commands;
mod fullscreen;

use commands::{
    export_review, load_sidecar, open_document, open_external, poll_source,
    queue_associated_document, read_local_image, reload_source, save_sidecar,
    take_pending_document, AppState,
};
use fullscreen::{
    handle_window_event, set_window_fullscreen, window_fullscreen_state, FullscreenState,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};

const OPEN_DOCUMENT_EVENT: &str = "revdown-open-document";

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
    let queued = std::env::args_os().skip(1).any(|argument| {
        let path = PathBuf::from(argument);
        let path = if path.is_absolute() {
            path
        } else if let Some(directory) = &current_directory {
            directory.join(path)
        } else {
            path
        };
        queue_associated_document(&state, path)
    });
    if queued {
        focus_and_notify(app.handle());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, cwd| {
        let state = app.state::<AppState>();
        let current_directory = PathBuf::from(cwd);
        let queued = arguments.into_iter().skip(1).any(|argument| {
            let path = PathBuf::from(argument);
            let path = if path.is_absolute() {
                path
            } else {
                current_directory.join(path)
            };
            queue_associated_document(&state, path)
        });
        if queued {
            focus_and_notify(app);
        }
    }));

    let app = builder
        .manage(AppState::default())
        .manage(Arc::new(FullscreenState::default()))
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            open_document,
            load_sidecar,
            save_sidecar,
            export_review,
            poll_source,
            reload_source,
            read_local_image,
            open_external,
            take_pending_document,
            set_window_fullscreen,
            window_fullscreen_state
        ])
        .build(tauri::generate_context!())
        .expect("error while building Revdown");

    queue_startup_document(&app);
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let state = _app.state::<AppState>();
            let queued = urls.into_iter().any(|url| {
                url.to_file_path()
                    .ok()
                    .is_some_and(|path| queue_associated_document(&state, path))
            });
            if queued {
                focus_and_notify(_app);
            }
        }
    });
}
