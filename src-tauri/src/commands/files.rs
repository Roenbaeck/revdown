use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::State;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Session {
    source_path: PathBuf,
}

#[derive(Default)]
pub struct AppState {
    sessions: Mutex<HashMap<String, Session>>,
}

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

fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_source(path: &Path) -> CommandResult<(String, SourceRevision)> {
    let bytes = fs::read(path).map_err(CommandError::io)?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| {
        CommandError::new(
            "invalid_utf8",
            "Revdown can open only valid UTF-8 Markdown files.",
        )
    })?;
    let metadata = fs::metadata(path).map_err(CommandError::io)?;
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

fn atomic_write(destination: &Path, contents: &[u8]) -> CommandResult<()> {
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
    let operation = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temp_path, destination)?;
        #[cfg(unix)]
        File::open(directory)?.sync_all()?;
        Ok(())
    })();
    if operation.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    operation.map_err(CommandError::io)
}

fn save_sidecar_file(
    source_path: &Path,
    contents: &str,
    expected_revision: Option<&str>,
) -> CommandResult<SaveResult> {
    let filename = source_filename(source_path)?;
    validate_sidecar(contents, &filename)?;
    let path = sidecar_path(source_path)?;
    let current = current_revision(&path)?;
    if current.as_deref() != expected_revision {
        return Err(CommandError::new(
            "sidecar_conflict",
            "The sidecar changed outside Revdown. Reload it before saving again.",
        ));
    }
    atomic_write(&path, contents.as_bytes())?;
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
    let filename = source_filename(&source_path)?;
    let (content, revision) = read_source(&source_path)?;
    let session_id = Uuid::new_v4().to_string();
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_error", "The document session is unavailable."))?
        .insert(session_id.clone(), Session { source_path });
    Ok(Some(OpenedDocument {
        session_id,
        filename,
        content,
        revision,
    }))
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
    atomic_write(&destination, contents.as_bytes())?;
    Ok(ExportResult { saved: true })
}

#[tauri::command]
pub fn poll_source(
    state: State<'_, AppState>,
    session_id: String,
) -> CommandResult<SourceRevision> {
    let session = session_for(&state, &session_id)?;
    read_source(&session.source_path).map(|(_, revision)| revision)
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
