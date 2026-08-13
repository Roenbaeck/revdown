mod commands;

use commands::{
    export_review, load_sidecar, open_document, open_external, poll_source, read_local_image,
    reload_source, save_sidecar, AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_document,
            load_sidecar,
            save_sidecar,
            export_review,
            poll_source,
            reload_source,
            read_local_image,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running Revdown");
}
