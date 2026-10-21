//! 工作区目录的惰性枚举（SPEC F1.4）。
//!
//! 前端只在用户展开目录时请求一层子项；命令绝不递归扫描整个工作区。

use crate::error::{AppError, AppResult};
use crate::file_io::FileFingerprint;
use crate::state::AppState;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::Emitter;

const DIRECTORY_CHANGED_EVENT: &str = "app://workspace-directory-changed";
const DIRECTORY_WATCH_DEBOUNCE: Duration = Duration::from_millis(300);

type DirectoryWatcher =
    Debouncer<notify::RecommendedWatcher, notify_debouncer_full::RecommendedCache>;

#[derive(Default)]
pub struct WorkspaceWatchers {
    watchers: Mutex<HashMap<String, DirectoryWatcher>>,
}

impl WorkspaceWatchers {
    fn watch(&self, path: PathBuf, app: tauri::AppHandle) -> AppResult<()> {
        let key = path.to_string_lossy().into_owned();
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?;
        if watchers.contains_key(&key) {
            return Ok(());
        }

        let (tx, rx) = mpsc::channel::<Result<Vec<DebouncedEvent>, Vec<notify::Error>>>();
        let mut watcher = new_debouncer(DIRECTORY_WATCH_DEBOUNCE, None, tx)
            .map_err(|_| AppError::Io { os_code: None })?;
        watcher
            .watch(&path, RecursiveMode::NonRecursive)
            .map_err(|_| AppError::Io { os_code: None })?;

        let event_path = key.clone();
        std::thread::spawn(move || {
            for batch in rx {
                if batch.is_err() {
                    continue;
                }
                if app.emit(DIRECTORY_CHANGED_EVENT, &event_path).is_err() {
                    log::warn!("文件树目录变更事件发送失败");
                }
            }
        });
        watchers.insert(key, watcher);
        Ok(())
    }

    fn unwatch(&self, path: &str) -> AppResult<()> {
        self.watchers
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?
            .remove(path);
        Ok(())
    }

    fn clear(&self) -> AppResult<()> {
        self.watchers
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?
            .clear();
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryArgs {
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryArgs {
    pub root: PathBuf,
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspaceEntryArgs {
    pub root: PathBuf,
    pub path: PathBuf,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceEntryArgs {
    pub root: PathBuf,
    /// 已规范化的目标目录；允许等于工作区根目录。
    pub directory: PathBuf,
    pub name: String,
    pub kind: WorkspaceEntryKind,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub path: String,
    pub name: String,
    pub kind: WorkspaceEntryKind,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrashOutcome {
    Moved,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub outcome: TrashOutcome,
    pub document_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub document_ids: Vec<String>,
}

/// 只读取一个目录层级。路径先规范化，避免随后展开时从工作区根以外的相对路径起步。
#[tauri::command]
pub async fn list_directory(args: ListDirectoryArgs) -> AppResult<Vec<WorkspaceEntry>> {
    tauri::async_runtime::spawn_blocking(move || list_directory_sync(&args.path))
        .await
        .map_err(|_| AppError::Io { os_code: None })?
}

/// 只监听前端已展开的目录。监听器由 `WorkspaceWatchers` 持有，折叠时显式释放。
#[tauri::command]
pub fn watch_directory(
    args: ListDirectoryArgs,
    app: tauri::AppHandle,
    watchers: tauri::State<'_, WorkspaceWatchers>,
) -> AppResult<String> {
    let canonical =
        std::fs::canonicalize(&args.path).map_err(|error| AppError::from_io(&error, &args.path))?;
    if !canonical.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&canonical),
        });
    }
    watchers.watch(canonical.clone(), app)?;
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn unwatch_directory(
    args: ListDirectoryArgs,
    watchers: tauri::State<'_, WorkspaceWatchers>,
) -> AppResult<()> {
    watchers.unwatch(&args.path.to_string_lossy())
}

#[tauri::command]
pub fn unwatch_all_directories(watchers: tauri::State<'_, WorkspaceWatchers>) -> AppResult<()> {
    watchers.clear()
}

#[tauri::command]
pub async fn rename_workspace_entry(
    args: RenameWorkspaceEntryArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<WorkspaceEntry> {
    let (entry, source, destination) = tauri::async_runtime::spawn_blocking(move || {
        rename_workspace_entry_with_paths(&args.root, &args.path, &args.name)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;
    sync_document_paths_after_rename(&state, &source, &destination);
    Ok(entry)
}

/// 在已打开工作区的一个目录内创建空文件或文件夹。
///
/// `directory` 与 `root` 都会重新规范化，不能借由前端传入的路径越出工作区。
#[tauri::command]
pub async fn create_workspace_entry(args: CreateWorkspaceEntryArgs) -> AppResult<WorkspaceEntry> {
    tauri::async_runtime::spawn_blocking(move || {
        create_workspace_entry_sync(&args.root, &args.directory, &args.name, args.kind)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })?
}

/// 默认删除路径：尽最大努力移入系统回收站，绝不在这里直接 unlink。
/// 回收站不可用时，前端必须明确提示并再次确认，才可调用永久删除命令。
#[tauri::command]
pub async fn move_workspace_entry_to_trash(
    args: WorkspaceEntryArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<TrashResult> {
    let (outcome, path) = tauri::async_runtime::spawn_blocking(move || {
        move_workspace_entry_to_trash_sync(&args.root, &args.path)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;
    Ok(TrashResult {
        document_ids: if outcome == TrashOutcome::Moved {
            affected_document_ids(&state, &path)?
        } else {
            Vec::new()
        },
        outcome,
    })
}

#[tauri::command]
pub async fn permanently_delete_workspace_entry(
    args: WorkspaceEntryArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DeleteResult> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        permanently_delete_workspace_entry_sync(&args.root, &args.path)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;
    Ok(DeleteResult {
        document_ids: affected_document_ids(&state, &path)?,
    })
}

fn affected_document_ids(state: &AppState, deleted_path: &Path) -> AppResult<Vec<String>> {
    let mut ids = Vec::new();
    for entry in &state.documents {
        let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
        if document
            .path
            .as_deref()
            .is_some_and(|path| path.starts_with(deleted_path))
        {
            ids.push(document.id.clone());
        }
    }
    Ok(ids)
}

fn workspace_entry_path(root: &Path, path: &Path) -> AppResult<PathBuf> {
    let root = std::fs::canonicalize(root).map_err(|error| AppError::from_io(&error, root))?;
    if !root.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&root),
        });
    }
    let path = std::fs::canonicalize(path).map_err(|error| AppError::from_io(&error, path))?;
    if path == root || !path.starts_with(&root) {
        return Err(AppError::InvalidPath {
            path_hint: crate::error::path_hint(&path),
        });
    }
    Ok(path)
}

/// 创建的目标是目录，所以工作区根目录本身是合法目标；重命名和删除不适用此规则。
fn workspace_directory_path(root: &Path, directory: &Path) -> AppResult<PathBuf> {
    let root = std::fs::canonicalize(root).map_err(|error| AppError::from_io(&error, root))?;
    if !root.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&root),
        });
    }
    let directory =
        std::fs::canonicalize(directory).map_err(|error| AppError::from_io(&error, directory))?;
    if !directory.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&directory),
        });
    }
    if !directory.starts_with(&root) {
        return Err(AppError::InvalidPath {
            path_hint: crate::error::path_hint(&directory),
        });
    }
    Ok(directory)
}

fn validate_entry_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || matches!(trimmed, "." | "..")
        || trimmed.contains(['/', '\\'])
        || trimmed.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        || is_windows_reserved_name(trimmed);
    if invalid {
        return Err(AppError::InvalidPath {
            path_hint: trimmed.to_owned(),
        });
    }
    Ok(())
}

fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.get(3..).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

#[cfg(test)]
fn rename_workspace_entry_sync(root: &Path, path: &Path, name: &str) -> AppResult<WorkspaceEntry> {
    rename_workspace_entry_with_paths(root, path, name).map(|(entry, _, _)| entry)
}

fn rename_workspace_entry_with_paths(
    root: &Path,
    path: &Path,
    name: &str,
) -> AppResult<(WorkspaceEntry, PathBuf, PathBuf)> {
    validate_entry_name(name)?;
    let path = workspace_entry_path(root, path)?;
    let parent = path.parent().ok_or_else(|| AppError::InvalidPath {
        path_hint: crate::error::path_hint(&path),
    })?;
    let destination = parent.join(name.trim());
    if destination.exists() {
        return Err(AppError::AlreadyExists {
            path_hint: crate::error::path_hint(&destination),
        });
    }
    let kind = if path.is_dir() {
        WorkspaceEntryKind::Directory
    } else {
        WorkspaceEntryKind::File
    };
    std::fs::rename(&path, &destination).map_err(|error| AppError::from_io(&error, &path))?;
    let entry = WorkspaceEntry {
        path: destination.to_string_lossy().into_owned(),
        name: name.trim().to_owned(),
        kind,
    };
    Ok((entry, path, destination))
}

fn create_workspace_entry_sync(
    root: &Path,
    directory: &Path,
    name: &str,
    kind: WorkspaceEntryKind,
) -> AppResult<WorkspaceEntry> {
    validate_entry_name(name)?;
    let directory = workspace_directory_path(root, directory)?;
    let destination = directory.join(name.trim());
    if destination.exists() {
        return Err(AppError::AlreadyExists {
            path_hint: crate::error::path_hint(&destination),
        });
    }
    match kind {
        WorkspaceEntryKind::Directory => {
            std::fs::create_dir(&destination)
                .map_err(|error| AppError::from_io(&error, &destination))?;
        }
        WorkspaceEntryKind::File => {
            std::fs::File::create(&destination)
                .map_err(|error| AppError::from_io(&error, &destination))?;
        }
    }
    Ok(WorkspaceEntry {
        path: destination.to_string_lossy().into_owned(),
        name: name.trim().to_owned(),
        kind,
    })
}

fn sync_document_paths_after_rename(state: &AppState, source: &Path, destination: &Path) {
    for entry in state.documents.iter() {
        let mut document = match entry.value().write() {
            Ok(document) => document,
            Err(_) => continue,
        };
        let Some(path) = document.path.as_deref() else {
            continue;
        };
        let Ok(suffix) = path.strip_prefix(source) else {
            continue;
        };
        let next_path = destination.join(suffix);
        document.path = Some(next_path.clone());
        document.fingerprint = FileFingerprint::read(&next_path).ok();
    }
}

fn move_workspace_entry_to_trash_sync(
    root: &Path,
    path: &Path,
) -> AppResult<(TrashOutcome, PathBuf)> {
    let path = workspace_entry_path(root, path)?;
    match trash::delete(&path) {
        Ok(()) => Ok((TrashOutcome::Moved, path)),
        Err(_) => Ok((TrashOutcome::Unavailable, path)),
    }
}

fn permanently_delete_workspace_entry_sync(root: &Path, path: &Path) -> AppResult<PathBuf> {
    let path = workspace_entry_path(root, path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|error| AppError::from_io(&error, &path))?;
    } else {
        std::fs::remove_file(&path).map_err(|error| AppError::from_io(&error, &path))?;
    }
    Ok(path)
}

fn list_directory_sync(path: &PathBuf) -> AppResult<Vec<WorkspaceEntry>> {
    let canonical = std::fs::canonicalize(path).map_err(|error| AppError::from_io(&error, path))?;
    if !canonical.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&canonical),
        });
    }

    let entries =
        std::fs::read_dir(&canonical).map_err(|error| AppError::from_io(&error, &canonical))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| AppError::from_io(&error, &canonical))?;
        let file_type = entry
            .file_type()
            .map_err(|error| AppError::from_io(&error, entry.path()))?;
        let path = entry.path();
        result.push(WorkspaceEntry {
            path: path.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            // 不追随链接：递归展开链接目录会引入循环与越界风险。
            kind: if file_type.is_dir() {
                WorkspaceEntryKind::Directory
            } else {
                WorkspaceEntryKind::File
            },
        });
    }

    result.sort_by(|left, right| {
        let kind = match (left.kind, right.kind) {
            (WorkspaceEntryKind::Directory, WorkspaceEntryKind::File) => Ordering::Less,
            (WorkspaceEntryKind::File, WorkspaceEntryKind::Directory) => Ordering::Greater,
            _ => Ordering::Equal,
        };
        kind.then_with(|| natural_compare(&left.name, &right.name))
    });
    Ok(result)
}

/// 文件管理器式的自然排序：`file2` 在 `file10` 之前，且不受大小写影响。
fn natural_compare(left: &str, right: &str) -> Ordering {
    let mut left = left.chars().peekable();
    let mut right = right.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_char), Some(right_char))
                if left_char.is_ascii_digit() && right_char.is_ascii_digit() =>
            {
                let left_number = take_number(&mut left);
                let right_number = take_number(&mut right);
                match left_number.cmp(&right_number) {
                    Ordering::Equal => {}
                    order => return order,
                }
            }
            (Some(left_char), Some(right_char)) => {
                let order = left_char
                    .to_ascii_lowercase()
                    .cmp(&right_char.to_ascii_lowercase());
                left.next();
                right.next();
                if order != Ordering::Equal {
                    return order;
                }
            }
        }
    }
}

fn take_number(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> u128 {
    let mut value = 0_u128;
    while let Some(char) = chars.peek().copied() {
        if !char.is_ascii_digit() {
            break;
        }
        chars.next();
        value = value
            .saturating_mul(10)
            .saturating_add(u128::from(char.to_digit(10).unwrap_or_default()));
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directories_precede_files_and_names_are_natural() {
        let directory = tempfile::tempdir().expect("临时目录");
        std::fs::create_dir(directory.path().join("folder10")).expect("目录");
        std::fs::create_dir(directory.path().join("folder2")).expect("目录");
        std::fs::write(directory.path().join("file10.txt"), "").expect("文件");
        std::fs::write(directory.path().join("file2.txt"), "").expect("文件");

        let entries = list_directory_sync(&directory.path().to_path_buf()).expect("列目录");
        let names: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["folder2", "folder10", "file2.txt", "file10.txt"]);
    }

    #[test]
    fn list_directory_refuses_a_file() {
        let directory = tempfile::tempdir().expect("临时目录");
        let file = directory.path().join("single.txt");
        std::fs::write(&file, "").expect("文件");

        let result = list_directory_sync(&file);
        assert!(matches!(result, Err(AppError::NotDirectory { .. })));
    }

    #[test]
    fn rename_rejects_invalid_names_and_conflicts() {
        let directory = tempfile::tempdir().expect("临时目录");
        let original = directory.path().join("old.txt");
        std::fs::write(&original, "old").expect("文件");
        std::fs::write(directory.path().join("new.txt"), "new").expect("文件");

        assert!(matches!(
            rename_workspace_entry_sync(directory.path(), &original, "CON.txt"),
            Err(AppError::InvalidPath { .. })
        ));
        assert!(matches!(
            rename_workspace_entry_sync(directory.path(), &original, "new.txt"),
            Err(AppError::AlreadyExists { .. })
        ));
    }

    #[test]
    fn rename_stays_inside_workspace_and_returns_the_new_entry() {
        let directory = tempfile::tempdir().expect("临时目录");
        let original = directory.path().join("old.txt");
        std::fs::write(&original, "old").expect("文件");

        let entry = rename_workspace_entry_sync(directory.path(), &original, "renamed.txt")
            .expect("重命名");

        assert_eq!(entry.name, "renamed.txt");
        assert_eq!(entry.kind, WorkspaceEntryKind::File);
        assert!(directory.path().join("renamed.txt").is_file());
        assert!(!original.exists());
    }

    #[test]
    fn creates_files_and_directories_at_the_requested_workspace_directory() {
        let root = tempfile::tempdir().expect("工作区");
        let nested = root.path().join("nested");
        std::fs::create_dir(&nested).expect("子目录");

        let file = create_workspace_entry_sync(
            root.path(),
            root.path(),
            "notes.md",
            WorkspaceEntryKind::File,
        )
        .expect("创建文件");
        let directory = create_workspace_entry_sync(
            root.path(),
            &nested,
            "assets",
            WorkspaceEntryKind::Directory,
        )
        .expect("创建目录");

        assert_eq!(file.kind, WorkspaceEntryKind::File);
        assert!(root.path().join("notes.md").is_file());
        assert_eq!(directory.kind, WorkspaceEntryKind::Directory);
        assert!(nested.join("assets").is_dir());
    }

    #[test]
    fn create_rejects_outside_directories_invalid_names_and_conflicts() {
        let root = tempfile::tempdir().expect("工作区");
        let outside = tempfile::tempdir().expect("工作区外");
        std::fs::write(root.path().join("taken.txt"), "").expect("文件");

        assert!(matches!(
            create_workspace_entry_sync(
                root.path(),
                outside.path(),
                "outside.txt",
                WorkspaceEntryKind::File,
            ),
            Err(AppError::InvalidPath { .. })
        ));
        assert!(matches!(
            create_workspace_entry_sync(
                root.path(),
                root.path(),
                "folder/name",
                WorkspaceEntryKind::Directory,
            ),
            Err(AppError::InvalidPath { .. })
        ));
        assert!(matches!(
            create_workspace_entry_sync(
                root.path(),
                root.path(),
                "taken.txt",
                WorkspaceEntryKind::File,
            ),
            Err(AppError::AlreadyExists { .. })
        ));
    }

    #[test]
    fn move_to_trash_removes_a_workspace_file_or_reports_unavailable() {
        let directory = tempfile::tempdir().expect("工作区");
        let file = directory.path().join("discard.txt");
        std::fs::write(&file, "discard").expect("文件");

        let (outcome, _) =
            move_workspace_entry_to_trash_sync(directory.path(), &file).expect("移动到回收站");

        match outcome {
            TrashOutcome::Moved => assert!(!file.exists()),
            TrashOutcome::Unavailable => assert!(file.exists()),
        }
    }

    #[test]
    fn destructive_operations_reject_workspace_root_and_outside_paths() {
        let root = tempfile::tempdir().expect("工作区");
        let outside = tempfile::tempdir().expect("工作区外");
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&outside_file, "outside").expect("文件");

        assert!(matches!(
            permanently_delete_workspace_entry_sync(root.path(), root.path()),
            Err(AppError::InvalidPath { .. })
        ));
        assert!(matches!(
            permanently_delete_workspace_entry_sync(root.path(), &outside_file),
            Err(AppError::InvalidPath { .. })
        ));
        assert!(outside_file.exists());
    }

    #[test]
    fn affected_documents_include_open_descendants_but_not_sibling_names() {
        let state = AppState::default();
        for (id, path) in [
            ("a", "/work/drafts/a.txt"),
            ("b", "/work/drafts/nested/b.txt"),
            ("c", "/work/drafts-old/c.txt"),
        ] {
            state.documents.insert(
                id.to_string(),
                std::sync::RwLock::new(crate::state::Document::new(
                    id.to_string(),
                    Some(path.into()),
                    "",
                )),
            );
        }

        let mut ids =
            affected_document_ids(&state, Path::new("/work/drafts")).expect("读取已打开文档");
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
    }
}
