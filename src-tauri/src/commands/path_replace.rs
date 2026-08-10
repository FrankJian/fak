//! 跨文件替换的预览与安全落盘（SPEC F4.6、P5、§10.4）。
//!
//! 预览会话保存的不是用户选中的字节内容，而是已验证路径、原始指纹与编辑计划。
//! 应用时重新读取并把该指纹交给 `save_atomic`，因此预览后被外部修改的文件绝不覆盖。

use crate::encoding::{decode, detect, encode, EncodingLabel};
use crate::error::{AppError, AppResult};
use crate::file_io::{save_atomic, ConflictPolicy, FileFingerprint};
use crate::path_search::{scan, ScanRequest, SkipReason, SkippedPath};
use crate::search::{compile, plan_replacements, ReplaceEdit, SearchOptions};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_SESSIONS: usize = 16;

#[derive(Debug, Default)]
pub struct PathReplaceState {
    sessions: DashMap<String, PathReplaceSession>,
    next_id: AtomicU64,
}

#[derive(Debug)]
struct PathReplaceSession {
    files: Vec<FilePlan>,
    skipped: Vec<SkippedPath>,
}

#[derive(Debug)]
struct FilePlan {
    path: PathBuf,
    relative_path: String,
    fingerprint: FileFingerprint,
    encoding: EncodingLabel,
    edits: Vec<ReplaceEdit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReplacePreviewArgs {
    pub scope: PathBuf,
    pub query: String,
    pub replacement: String,
    pub options: SearchOptions,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub respect_gitignore: bool,
    pub include_hidden: bool,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementPreview {
    pub index: usize,
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReplacePreview {
    pub path: String,
    pub replacements: Vec<ReplacementPreview>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReplacePreview {
    pub session_id: String,
    pub files: Vec<FileReplacePreview>,
    pub file_count: usize,
    pub replacement_count: usize,
    pub skipped: Vec<SkippedPath>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReplaceApplyArgs {
    pub session_id: String,
    /// 未列出的文件不改；空数组就是用户取消预览，安全地报告零修改。
    pub selected: Vec<SelectedFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFile {
    pub path: String,
    pub replacement_indexes: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathReplaceReport {
    pub changed_files: usize,
    pub changed_replacements: usize,
    pub skipped: Vec<SkippedPath>,
}

#[tauri::command]
pub async fn path_replace_preview(
    args: PathReplacePreviewArgs,
    state: tauri::State<'_, std::sync::Arc<PathReplaceState>>,
) -> AppResult<PathReplacePreview> {
    let request = ScanRequest {
        scope: args.scope,
        query: args.query.clone(),
        options: args.options,
        include_globs: args.include_globs,
        exclude_globs: args.exclude_globs,
        respect_gitignore: args.respect_gitignore,
        include_hidden: args.include_hidden,
        recursive: args.recursive,
    };
    let scanned = tauri::async_runtime::spawn_blocking(move || scan(&request, || false))
        .await
        .map_err(|_| AppError::Io { os_code: None })??;
    let regex = compile(&args.query, args.options)?;
    let mut paths = BTreeMap::<String, PathBuf>::new();
    for hit in scanned.matches {
        paths.entry(hit.relative_path).or_insert(hit.path);
    }

    let mut skipped_paths = scanned.skipped;
    let mut plans = Vec::new();
    for (relative_path, path) in paths {
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) if !metadata.permissions().readonly() => metadata,
            Ok(_) => {
                skipped_paths.push(skipped(&path, SkipReason::ReadOnly));
                continue;
            }
            Err(_) => {
                skipped_paths.push(skipped(&path, SkipReason::ReadFailed));
                continue;
            }
        };
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped_paths.push(skipped(&path, SkipReason::ReadFailed));
                continue;
            }
        };
        let encoding = detect(&bytes).label;
        let (text, _) = decode(&bytes, encoding);
        let edits =
            plan_replacements(&text, &regex, &args.replacement, args.options, None, || {
                false
            })?;
        if edits.is_empty() {
            continue;
        }
        plans.push(FilePlan {
            path,
            relative_path,
            fingerprint: FileFingerprint::from_metadata(&metadata),
            encoding,
            edits,
        });
    }
    let preview_files = plans.iter().map(preview_file).collect::<Vec<_>>();
    let replacement_count = plans.iter().map(|file| file.edits.len()).sum();
    let session_id = state.store(PathReplaceSession {
        files: plans,
        skipped: skipped_paths.clone(),
    });
    Ok(PathReplacePreview {
        session_id,
        file_count: preview_files.len(),
        replacement_count,
        files: preview_files,
        skipped: skipped_paths,
    })
}

#[tauri::command]
pub async fn path_replace_apply(
    args: PathReplaceApplyArgs,
    state: tauri::State<'_, std::sync::Arc<PathReplaceState>>,
) -> AppResult<PathReplaceReport> {
    let (_, session) =
        state
            .sessions
            .remove(&args.session_id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: args.session_id.clone(),
            })?;
    let selected = args
        .selected
        .into_iter()
        .map(|item| (item.path, item.replacement_indexes))
        .collect::<HashMap<_, _>>();
    let mut report = PathReplaceReport {
        changed_files: 0,
        changed_replacements: 0,
        skipped: session.skipped,
    };

    for file in session.files {
        let Some(indexes) = selected.get(&file.relative_path) else {
            continue;
        };
        let edits = indexes
            .iter()
            .filter_map(|&index| file.edits.get(index).cloned())
            .collect::<Vec<_>>();
        if edits.is_empty() {
            continue;
        }
        let bytes = match std::fs::read(&file.path) {
            Ok(bytes) => bytes,
            Err(_) => {
                report
                    .skipped
                    .push(skipped(&file.path, SkipReason::ReadFailed));
                continue;
            }
        };
        let (text, _) = decode(&bytes, file.encoding);
        let updated = apply_edits(&text, &edits)?;
        let output = encode(&updated, file.encoding)?;
        let path = file.path.clone();
        let expected = file.fingerprint;
        match tauri::async_runtime::spawn_blocking(move || {
            save_atomic(&path, &output, Some(expected), ConflictPolicy::Abort)
        })
        .await
        {
            Ok(Ok(_)) => {
                report.changed_files += 1;
                report.changed_replacements += edits.len();
            }
            Ok(Err(AppError::VersionConflict { .. })) => report
                .skipped
                .push(skipped(&file.path, SkipReason::ReadFailed)),
            Ok(Err(_)) | Err(_) => report
                .skipped
                .push(skipped(&file.path, SkipReason::ReadFailed)),
        }
    }
    Ok(report)
}

fn preview_file(file: &FilePlan) -> FileReplacePreview {
    let text = std::fs::read(&file.path)
        .ok()
        .map(|bytes| decode(&bytes, file.encoding).0)
        .unwrap_or_default();
    let replacements = file
        .edits
        .iter()
        .enumerate()
        .map(|(index, edit)| {
            let (line, before) = line_at(&text, edit.start);
            let after = replace_one_line(&before, edit, &text);
            ReplacementPreview {
                index,
                line,
                before,
                after,
            }
        })
        .collect();
    FileReplacePreview {
        path: file.relative_path.clone(),
        replacements,
    }
}

fn line_at(text: &str, offset: usize) -> (usize, String) {
    let byte = utf16_to_byte(text, offset);
    let start = text[..byte].rfind('\n').map_or(0, |index| index + 1);
    let end = text[byte..]
        .find('\n')
        .map_or(text.len(), |index| byte + index);
    (
        text[..start].bytes().filter(|byte| *byte == b'\n').count(),
        text[start..end].trim_end_matches('\r').to_string(),
    )
}

fn replace_one_line(line: &str, edit: &ReplaceEdit, text: &str) -> String {
    let global_start = utf16_to_byte(text, edit.start);
    let line_start = text[..global_start]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let from = global_start - line_start;
    let to = utf16_to_byte(text, edit.end).saturating_sub(line_start);
    if from > line.len() || to > line.len() {
        return line.to_string();
    }
    format!("{}{}{}", &line[..from], edit.insert, &line[to..])
}

fn apply_edits(text: &str, edits: &[ReplaceEdit]) -> AppResult<String> {
    let mut out = text.to_string();
    for edit in edits.iter().rev() {
        let start = utf16_to_byte(&out, edit.start);
        let end = utf16_to_byte(&out, edit.end);
        if start > end {
            return Err(AppError::Io { os_code: None });
        }
        out.replace_range(start..end, &edit.insert);
    }
    Ok(out)
}

fn utf16_to_byte(text: &str, target: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= target {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

fn skipped(path: &std::path::Path, reason: SkipReason) -> SkippedPath {
    SkippedPath {
        path_hint: crate::error::path_hint(path),
        reason,
    }
}

impl PathReplaceState {
    fn store(&self, session: PathReplaceSession) -> String {
        while self.sessions.len() >= MAX_SESSIONS {
            if let Some(entry) = self.sessions.iter().next() {
                let id = entry.key().clone();
                drop(entry);
                self.sessions.remove(&id);
            } else {
                break;
            }
        }
        let id = format!(
            "path-replace-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        self.sessions.insert(id.clone(), session);
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_edits_apply_back_to_front_in_utf16_coordinates() {
        let text = "中 foo 😀 foo";
        let edits = vec![
            ReplaceEdit {
                start: 2,
                end: 5,
                insert: "bar".into(),
            },
            ReplaceEdit {
                start: 9,
                end: 12,
                insert: "baz".into(),
            },
        ];

        assert_eq!(apply_edits(text, &edits).expect("apply"), "中 bar 😀 baz");
    }

    #[test]
    fn preview_window_reports_the_line_containing_the_change() {
        let text = "first\n中 foo\nlast";
        let edit = ReplaceEdit {
            start: 8,
            end: 11,
            insert: "bar".into(),
        };
        let (line, before) = line_at(text, edit.start);

        assert_eq!(line, 1);
        assert_eq!(before, "中 foo");
        assert_eq!(replace_one_line(&before, &edit, text), "中 bar");
    }

    #[test]
    fn replacement_sessions_are_single_use() {
        let state = PathReplaceState::default();
        let id = state.store(PathReplaceSession {
            files: Vec::new(),
            skipped: Vec::new(),
        });

        assert!(state.sessions.remove(&id).is_some());
        assert!(state.sessions.remove(&id).is_none());
    }
}
