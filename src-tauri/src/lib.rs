mod commands;
mod fullscreen;

use commands::{
    export_review, load_sidecar, open_document, open_external, poll_source, read_local_image,
    reload_source, save_sidecar, AppState,
};
use fullscreen::{
    handle_window_event, set_window_fullscreen, window_fullscreen_state, FullscreenState,
};
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            set_window_fullscreen,
            window_fullscreen_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running Revdown");
}
