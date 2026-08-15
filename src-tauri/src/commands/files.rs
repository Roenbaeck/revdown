use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{Emitter, State};
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Session {
    source_path: PathBuf,
}

#[derive(Default)]
pub struct AppState {
    sessions: Mutex<HashMap<String, Session>>,
    pending_documents: Mutex<VecDeque<PathBuf>>,
    source_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

const MAX_PENDING_DOCUMENTS: usize = 32;
const SOURCE_CHANGED_EVENT: &str = "revdown-source-changed";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: &'static str,
    message: String,
}

type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(_error: std::io::Error) -> Self {
        Self::new(
            "io_error",
            "The requested file operation could not be completed.",
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRevision {
    sha256: String,
    size: u64,
    modified_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    session_id: String,
    filename: String,
    content: String,
    revision: SourceRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSidecar {
    contents: Option<String>,
    revision: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    revision: String,
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    saved: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChangedEvent {
    session_id: String,
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_source(path: &Path) -> CommandResult<(String, SourceRevision)> {
    let mut file = File::open(path).map_err(CommandError::io)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| {
        CommandError::new(
            "invalid_utf8",
            "Revdown can open only valid UTF-8 Markdown files.",
        )
    })?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis());
    let revision = SourceRevision {
        sha256: hash_bytes(&bytes),
        size: metadata.len(),
        modified_ms,
    };
    Ok((content, revision))
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}

fn open_source_path(state: &AppState, source_path: PathBuf) -> CommandResult<OpenedDocument> {
    if !is_markdown_path(&source_path) {
        return Err(CommandError::new(
            "unsupported_document",
            "Revdown can open only Markdown documents.",
        ));
    }
    let filename = source_filename(&source_path)?;
    let (content, revision) = read_source(&source_path)?;
    let session_id = Uuid::new_v4().to_string();
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_error", "The document session is unavailable."))?
        .insert(session_id.clone(), Session { source_path });
    Ok(OpenedDocument {
        session_id,
        filename,
        content,
        revision,
    })
}

pub fn queue_associated_document(state: &AppState, source_path: PathBuf) -> bool {
    if !is_markdown_path(&source_path) || !source_path.is_file() {
        return false;
    }
    let Ok(mut pending) = state.pending_documents.lock() else {
        return false;
    };
    if pending.len() >= MAX_PENDING_DOCUMENTS {
        return false;
    }
    pending.push_back(source_path);
    true
}

fn take_pending_document_from_state(state: &AppState) -> CommandResult<Option<OpenedDocument>> {
    let source_path = state
        .pending_documents
        .lock()
        .map_err(|_| CommandError::new("state_error", "The open request is unavailable."))?
        .pop_front();
    source_path
        .map(|path| open_source_path(state, path))
        .transpose()
}

fn session_for(state: &AppState, session_id: &str) -> CommandResult<Session> {
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_error", "The document session is unavailable."))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| {
            CommandError::new("invalid_session", "The document session is no longer open.")
        })
}

fn source_filename(path: &Path) -> CommandResult<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            CommandError::new(
                "invalid_filename",
                "The selected file has an unsupported filename.",
            )
        })
}

fn sidecar_path(source_path: &Path) -> CommandResult<PathBuf> {
    let mut filename = source_path
        .file_name()
        .map(OsString::from)
        .ok_or_else(|| CommandError::new("invalid_filename", "The source file has no filename."))?;
    filename.push(".rd.json");
    Ok(source_path.with_file_name(filename))
}

fn current_revision(path: &Path) -> CommandResult<Option<String>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(hash_bytes(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CommandError::io(error)),
    }
}

fn source_bytes_changed(path: &Path, expected_sha256: &str) -> CommandResult<bool> {
    Ok(current_revision(path)?.as_deref() != Some(expected_sha256))
}

fn require_revision(path: &Path, expected_revision: Option<&str>) -> CommandResult<()> {
    let current = current_revision(path)?;
    if current.as_deref() != expected_revision {
        return Err(CommandError::new(
            "sidecar_conflict",
            "The sidecar changed outside Revdown. Reload it before saving again.",
        ));
    }
    Ok(())
}

fn validate_sidecar(contents: &str, expected_filename: &str) -> CommandResult<()> {
    let value: Value = serde_json::from_str(contents).map_err(|_| {
        CommandError::new("invalid_sidecar", "Refusing to write invalid sidecar JSON.")
    })?;
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(CommandError::new(
            "unsupported_schema",
            "Refusing to overwrite an unsupported sidecar schema version.",
        ));
    }
    let filename = value
        .get("source")
        .and_then(|source| source.get("filename"))
        .and_then(Value::as_str);
    if filename != Some(expected_filename) || !value.get("comments").is_some_and(Value::is_array) {
        return Err(CommandError::new(
            "invalid_sidecar",
            "The sidecar does not match the opened source document.",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(temp_path: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temp_path, destination)
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn atomic_write_checked(
    destination: &Path,
    contents: &[u8],
    check: impl FnOnce() -> CommandResult<()>,
) -> CommandResult<()> {
    let directory = destination.parent().ok_or_else(|| {
        CommandError::new(
            "invalid_destination",
            "The destination has no parent directory.",
        )
    })?;
    let filename = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("revdown");
    let temp_path = directory.join(format!(".{filename}.{}.tmp", Uuid::new_v4()));
    let prepare = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        Ok(())
    })();
    if let Err(error) = prepare {
        let _ = fs::remove_file(&temp_path);
        return Err(CommandError::io(error));
    }
    if let Err(error) = check() {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    let replace = (|| -> std::io::Result<()> {
        replace_file(&temp_path, destination)?;
        #[cfg(unix)]
        File::open(directory)?.sync_all()?;
        Ok(())
    })();
    if replace.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    replace.map_err(CommandError::io)
}

fn atomic_write(destination: &Path, contents: &[u8]) -> CommandResult<()> {
    atomic_write_checked(destination, contents, || Ok(()))
}

fn resolved_destination(path: &Path) -> CommandResult<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(CommandError::io)?
            .join(path)
    };
    match absolute.canonicalize() {
        Ok(resolved) => Ok(resolved),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = absolute.parent().ok_or_else(|| {
                CommandError::new(
                    "invalid_destination",
                    "The destination has no parent directory.",
                )
            })?;
            let filename = absolute.file_name().ok_or_else(|| {
                CommandError::new("invalid_destination", "The destination has no filename.")
            })?;
            Ok(parent
                .canonicalize()
                .map_err(CommandError::io)?
                .join(filename))
        }
        Err(error) => Err(CommandError::io(error)),
    }
}

#[cfg(windows)]
fn same_destination(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn watch_event_matches_source(event_path: &Path, source_path: &Path) -> bool {
    let Ok(event_path) = resolved_destination(event_path) else {
        return false;
    };
    let Ok(source_path) = resolved_destination(source_path) else {
        return false;
    };
    same_destination(&event_path, &source_path)
}

fn source_event_may_change_contents(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))
    )
}

#[cfg(not(windows))]
fn same_destination(left: &Path, right: &Path) -> bool {
    left == right
}

fn validate_export_destination(source_path: &Path, destination: &Path) -> CommandResult<()> {
    let resolved_export = resolved_destination(destination)?;
    let protected = [source_path.to_path_buf(), sidecar_path(source_path)?];
    for path in protected {
        let resolved_protected = resolved_destination(&path)?;
        if same_destination(&resolved_export, &resolved_protected) {
            return Err(CommandError::new(
                "protected_export_destination",
                "A review cannot replace the opened source or its canonical sidecar.",
            ));
        }
    }
    Ok(())
}

fn export_review_file(
    source_path: &Path,
    destination: &Path,
    contents: &[u8],
) -> CommandResult<()> {
    validate_export_destination(source_path, destination)?;
    atomic_write(destination, contents)
}

fn save_sidecar_file(
    source_path: &Path,
    contents: &str,
    expected_revision: Option<&str>,
) -> CommandResult<SaveResult> {
    save_sidecar_file_with_hook(source_path, contents, expected_revision, || {})
}

fn save_sidecar_file_with_hook(
    source_path: &Path,
    contents: &str,
    expected_revision: Option<&str>,
    before_revision_check: impl FnOnce(),
) -> CommandResult<SaveResult> {
    let filename = source_filename(source_path)?;
    validate_sidecar(contents, &filename)?;
    let path = sidecar_path(source_path)?;
    require_revision(&path, expected_revision)?;
    atomic_write_checked(&path, contents.as_bytes(), || {
        before_revision_check();
        require_revision(&path, expected_revision)
    })?;
    Ok(SaveResult {
        revision: hash_bytes(contents.as_bytes()),
    })
}

fn contained_local_path(base_directory: &Path, relative_path: &str) -> CommandResult<PathBuf> {
    let requested = Path::new(relative_path);
    if requested.is_absolute()
        || requested
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return Err(CommandError::new(
            "unsafe_path",
            "The image path leaves the document directory.",
        ));
    }
    let base = base_directory.canonicalize().map_err(CommandError::io)?;
    let candidate = base
        .join(requested)
        .canonicalize()
        .map_err(CommandError::io)?;
    if !candidate.starts_with(&base) {
        return Err(CommandError::new(
            "unsafe_path",
            "The image path leaves the document directory.",
        ));
    }
    Ok(candidate)
}

fn validated_external_url(value: &str) -> CommandResult<Url> {
    let parsed = Url::parse(value)
        .map_err(|_| CommandError::new("unsafe_url", "The selected link is not a valid URL."))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(CommandError::new(
            "unsafe_url",
            "This link scheme is not allowed.",
        ));
    }
    Ok(parsed)
}

#[tauri::command]
pub fn open_document(state: State<'_, AppState>) -> CommandResult<Option<OpenedDocument>> {
    let selected = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file();
    let Some(source_path) = selected else {
        return Ok(None);
    };
    open_source_path(&state, source_path).map(Some)
}

#[tauri::command]
pub fn take_pending_document(state: State<'_, AppState>) -> CommandResult<Option<OpenedDocument>> {
    take_pending_document_from_state(&state)
}

#[tauri::command]
pub fn load_sidecar(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<LoadedSidecar> {
    let session = session_for(&state, &session_id)?;
    let path = sidecar_path(&session.source_path)?;
    match fs::read(&path) {
        Ok(bytes) => {
            let revision = hash_bytes(&bytes);
            let contents = String::from_utf8(bytes).map_err(|_| {
                CommandError::new("invalid_sidecar", "The sidecar is not valid UTF-8.")
            })?;
            Ok(LoadedSidecar {
                contents: Some(contents),
                revision: Some(revision),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LoadedSidecar {
            contents: None,
            revision: None,
        }),
        Err(error) => Err(CommandError::io(error)),
    }
}

#[tauri::command]
pub fn save_sidecar(
    state: State<'_, AppState>,
    session_id: String,
    contents: String,
    expected_revision: Option<String>,
) -> CommandResult<SaveResult> {
    let session = session_for(&state, &session_id)?;
    save_sidecar_file(
        &session.source_path,
        &contents,
        expected_revision.as_deref(),
    )
}

#[tauri::command]
pub fn export_review(
    state: State<'_, AppState>,
    session_id: String,
    default_filename: String,
    contents: String,
) -> CommandResult<ExportResult> {
    let session = session_for(&state, &session_id)?;
    let directory = session
        .source_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let selected = rfd::FileDialog::new()
        .set_directory(directory)
        .set_file_name(&default_filename)
        .add_filter("Markdown", &["md"])
        .save_file();
    let Some(destination) = selected else {
        return Ok(ExportResult { saved: false });
    };
    export_review_file(&session.source_path, &destination, contents.as_bytes())?;
    Ok(ExportResult { saved: true })
}

#[tauri::command]
pub fn watch_source(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<()> {
    let session = session_for(&state, &session_id)?;
    let source_path = session.source_path;
    let directory = source_path
        .parent()
        .ok_or_else(|| {
            CommandError::new(
                "watch_failed",
                "The source document has no directory to watch.",
            )
        })?
        .to_path_buf();
    let event_session_id = session_id.clone();
    let mut watcher =
        notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
            let Ok(event) = result else {
                return;
            };
            if !source_event_may_change_contents(&event.kind) {
                return;
            }
            if event
                .paths
                .iter()
                .any(|path| watch_event_matches_source(path, &source_path))
            {
                let _ = app.emit(
                    SOURCE_CHANGED_EVENT,
                    SourceChangedEvent {
                        session_id: event_session_id.clone(),
                    },
                );
            }
        })
        .map_err(|_| {
            CommandError::new(
                "watch_failed",
                "Revdown could not watch the source document for changes.",
            )
        })?;
    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|_| {
            CommandError::new(
                "watch_failed",
                "Revdown could not watch the source document for changes.",
            )
        })?;
    state
        .source_watchers
        .lock()
        .map_err(|_| CommandError::new("state_error", "The source watcher is unavailable."))?
        .insert(session_id, watcher);
    Ok(())
}

#[tauri::command]
pub fn source_has_changed(
    state: State<'_, AppState>,
    session_id: String,
    expected_sha256: String,
) -> CommandResult<bool> {
    let session = session_for(&state, &session_id)?;
    source_bytes_changed(&session.source_path, &expected_sha256)
}

#[tauri::command]
pub fn unwatch_source(state: State<'_, AppState>, session_id: String) -> CommandResult<()> {
    state
        .source_watchers
        .lock()
        .map_err(|_| CommandError::new("state_error", "The source watcher is unavailable."))?
        .remove(&session_id);
    Ok(())
}

#[tauri::command]
pub fn reload_source(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<OpenedDocument> {
    let session = session_for(&state, &session_id)?;
    let filename = source_filename(&session.source_path)?;
    let (content, revision) = read_source(&session.source_path)?;
    Ok(OpenedDocument {
        session_id,
        filename,
        content,
        revision,
    })
}

#[tauri::command]
pub fn read_local_image(
    state: State<'_, AppState>,
    session_id: String,
    relative_path: String,
) -> CommandResult<Option<String>> {
    let session = session_for(&state, &session_id)?;
    let base_directory = session
        .source_path
        .parent()
        .ok_or_else(|| CommandError::new("unsafe_path", "The source has no document directory."))?;
    let candidate = contained_local_path(base_directory, &relative_path)?;
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => return Ok(None),
    };
    let bytes = fs::read(candidate).map_err(CommandError::io)?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(CommandError::new(
            "image_too_large",
            "Local images are limited to 10 MiB.",
        ));
    }
    Ok(Some(format!("data:{mime};base64,{}", BASE64.encode(bytes))))
}

#[tauri::command]
pub fn open_external(url: String) -> CommandResult<()> {
    let parsed = validated_external_url(&url)?;
    open::that_detached(parsed.as_str())
        .map_err(|_| CommandError::new("open_failed", "The system could not open this link."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{
        AccessKind, CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind, RenameMode,
    };
    use tempfile::tempdir;

    fn sidecar(filename: &str, marker: &str) -> String {
        format!(
            "{{\"schemaVersion\":1,\"source\":{{\"filename\":\"{filename}\"}},\"comments\":[],\"marker\":\"{marker}\"}}\n"
        )
    }

    #[test]
    fn sidecar_name_preserves_the_complete_source_filename() {
        assert_eq!(
            sidecar_path(Path::new("/tmp/notes.markdown")).unwrap(),
            PathBuf::from("/tmp/notes.markdown.rd.json")
        );
    }

    #[test]
    fn associated_markdown_is_opened_without_changing_source_bytes() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("Associated.MD");
        let source = b"# Associated\r\n\r\nOpened from Finder.\r\n";
        fs::write(&source_path, source).unwrap();
        let state = AppState::default();

        assert!(queue_associated_document(&state, source_path.clone()));
        let opened = take_pending_document_from_state(&state)
            .unwrap()
            .expect("queued document");

        assert_eq!(opened.filename, "Associated.MD");
        assert_eq!(opened.content.as_bytes(), source);
        assert_eq!(fs::read(source_path).unwrap(), source);
        assert!(take_pending_document_from_state(&state).unwrap().is_none());
    }

    #[test]
    fn associated_non_markdown_files_are_ignored() {
        let directory = tempdir().unwrap();
        let text_path = directory.path().join("notes.txt");
        fs::write(&text_path, b"plain text").unwrap();
        let state = AppState::default();

        assert!(!queue_associated_document(&state, text_path));
        assert!(take_pending_document_from_state(&state).unwrap().is_none());
    }

    #[test]
    fn associated_documents_are_opened_in_fifo_order() {
        let directory = tempdir().unwrap();
        let first_path = directory.path().join("first.md");
        let second_path = directory.path().join("second.md");
        fs::write(&first_path, b"first").unwrap();
        fs::write(&second_path, b"second").unwrap();
        let state = AppState::default();

        assert!(queue_associated_document(&state, first_path));
        assert!(queue_associated_document(&state, second_path));
        assert_eq!(
            take_pending_document_from_state(&state)
                .unwrap()
                .unwrap()
                .filename,
            "first.md"
        );
        assert_eq!(
            take_pending_document_from_state(&state)
                .unwrap()
                .unwrap()
                .filename,
            "second.md"
        );
        assert!(take_pending_document_from_state(&state).unwrap().is_none());
    }

    #[test]
    fn saving_a_sidecar_never_changes_source_bytes() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let source = b"# Source\r\n\r\nNever modify me.\r\n";
        fs::write(&source_path, source).unwrap();
        let result = save_sidecar_file(&source_path, &sidecar("document.md", "one"), None).unwrap();
        assert_eq!(fs::read(&source_path).unwrap(), source);
        assert_eq!(
            current_revision(&sidecar_path(&source_path).unwrap()).unwrap(),
            Some(result.revision)
        );
    }

    #[test]
    fn exports_cannot_replace_the_source_or_sidecar() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let sidecar_path = sidecar_path(&source_path).unwrap();
        let source = b"# Source\n\nNever modify me.\n";
        let canonical = sidecar("document.md", "canonical");
        fs::write(&source_path, source).unwrap();
        fs::write(&sidecar_path, &canonical).unwrap();

        for destination in [source_path.clone(), sidecar_path.clone()] {
            let error = export_review_file(&source_path, &destination, b"review").unwrap_err();
            assert_eq!(error.code, "protected_export_destination");
        }
        assert_eq!(fs::read(&source_path).unwrap(), source);
        assert_eq!(fs::read_to_string(sidecar_path).unwrap(), canonical);
    }

    #[test]
    fn exports_reject_normalized_source_paths_and_allow_safe_destinations() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let normalized_alias = directory.path().join(".").join("document.md");
        let export_path = directory.path().join("document.md.rd.md");
        let source = b"source";
        fs::write(&source_path, source).unwrap();

        assert_eq!(
            export_review_file(&source_path, &normalized_alias, b"review")
                .unwrap_err()
                .code,
            "protected_export_destination"
        );
        export_review_file(&source_path, &export_path, b"review").unwrap();
        assert_eq!(fs::read(&source_path).unwrap(), source);
        assert_eq!(fs::read(export_path).unwrap(), b"review");
    }

    #[cfg(unix)]
    #[test]
    fn exports_reject_symlink_aliases_of_the_source() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let alias_path = directory.path().join("alias.md");
        let source = b"source";
        fs::write(&source_path, source).unwrap();
        symlink(&source_path, &alias_path).unwrap();

        assert_eq!(
            export_review_file(&source_path, &alias_path, b"review")
                .unwrap_err()
                .code,
            "protected_export_destination"
        );
        assert_eq!(fs::read(&source_path).unwrap(), source);
    }

    #[cfg(windows)]
    #[test]
    fn exports_reject_case_variants_of_the_source() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("Document.MD");
        let case_variant = directory.path().join("document.md");
        let source = b"source";
        fs::write(&source_path, source).unwrap();

        assert_eq!(
            export_review_file(&source_path, &case_variant, b"review")
                .unwrap_err()
                .code,
            "protected_export_destination"
        );
        assert_eq!(fs::read(&source_path).unwrap(), source);
    }

    #[test]
    fn an_external_sidecar_change_causes_a_conflict() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        fs::write(&source_path, b"source").unwrap();
        let first = save_sidecar_file(&source_path, &sidecar("document.md", "one"), None).unwrap();
        fs::write(
            sidecar_path(&source_path).unwrap(),
            sidecar("document.md", "external"),
        )
        .unwrap();
        let error = save_sidecar_file(
            &source_path,
            &sidecar("document.md", "two"),
            Some(&first.revision),
        )
        .unwrap_err();
        assert_eq!(error.code, "sidecar_conflict");
        assert!(fs::read_to_string(sidecar_path(&source_path).unwrap())
            .unwrap()
            .contains("external"));
    }

    #[test]
    fn an_external_change_while_a_save_candidate_is_prepared_is_retained() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let sidecar_path = sidecar_path(&source_path).unwrap();
        fs::write(&source_path, b"source").unwrap();
        let first = save_sidecar_file(&source_path, &sidecar("document.md", "one"), None).unwrap();
        let external = sidecar("document.md", "external-during-save");

        let error = save_sidecar_file_with_hook(
            &source_path,
            &sidecar("document.md", "two"),
            Some(&first.revision),
            || fs::write(&sidecar_path, &external).unwrap(),
        )
        .unwrap_err();

        assert_eq!(error.code, "sidecar_conflict");
        assert_eq!(fs::read_to_string(sidecar_path).unwrap(), external);
    }

    #[test]
    fn invalid_or_wrong_source_sidecars_are_refused() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        fs::write(&source_path, b"source").unwrap();
        assert!(save_sidecar_file(&source_path, "{}", None).is_err());
        assert!(save_sidecar_file(&source_path, &sidecar("other.md", "wrong"), None).is_err());
        assert!(!sidecar_path(&source_path).unwrap().exists());
    }

    #[test]
    fn local_images_cannot_escape_the_document_directory() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("image.png");
        fs::write(&image, b"png").unwrap();
        assert_eq!(
            contained_local_path(directory.path(), "./image.png").unwrap(),
            image.canonicalize().unwrap()
        );
        assert_eq!(
            contained_local_path(directory.path(), "../outside.png")
                .unwrap_err()
                .code,
            "unsafe_path"
        );
        assert_eq!(
            contained_local_path(directory.path(), "/tmp/outside.png")
                .unwrap_err()
                .code,
            "unsafe_path"
        );
    }

    #[test]
    fn source_watch_events_are_scoped_to_the_opened_file() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let sibling_path = directory.path().join("sibling.md");
        fs::write(&source_path, b"source").unwrap();
        fs::write(&sibling_path, b"sibling").unwrap();

        assert!(watch_event_matches_source(&source_path, &source_path));
        assert!(watch_event_matches_source(
            &directory.path().join(".").join("document.md"),
            &source_path
        ));
        assert!(!watch_event_matches_source(&sibling_path, &source_path));
    }

    #[test]
    fn source_watch_ignores_events_that_cannot_change_file_bytes() {
        for kind in [
            EventKind::Access(AccessKind::Any),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Ownership)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime)),
        ] {
            assert!(!source_event_may_change_contents(&kind));
        }

        for kind in [
            EventKind::Any,
            EventKind::Create(CreateKind::File),
            EventKind::Remove(RemoveKind::File),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            EventKind::Modify(ModifyKind::Any),
            EventKind::Other,
        ] {
            assert!(source_event_may_change_contents(&kind));
        }
    }

    #[test]
    fn source_change_confirmation_compares_file_bytes() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("document.md");
        let source = b"# Source\n";
        fs::write(&source_path, source).unwrap();
        let expected_sha256 = hash_bytes(source);

        assert!(!source_bytes_changed(&source_path, &expected_sha256).unwrap());
        fs::write(&source_path, source).unwrap();
        assert!(!source_bytes_changed(&source_path, &expected_sha256).unwrap());
        fs::write(&source_path, b"# Changed\n").unwrap();
        assert!(source_bytes_changed(&source_path, &expected_sha256).unwrap());
        fs::remove_file(&source_path).unwrap();
        assert!(source_bytes_changed(&source_path, &expected_sha256).unwrap());
    }

    #[test]
    fn external_links_allow_only_explicit_safe_schemes() {
        assert!(validated_external_url("https://example.com/path").is_ok());
        assert!(validated_external_url("mailto:reviewer@example.com").is_ok());
        assert_eq!(
            validated_external_url("javascript:alert(1)")
                .unwrap_err()
                .code,
            "unsafe_url"
        );
        assert_eq!(
            validated_external_url("file:///private/document.md")
                .unwrap_err()
                .code,
            "unsafe_url"
        );
    }
}
