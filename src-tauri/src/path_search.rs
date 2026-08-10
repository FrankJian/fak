//! 跨文件查找的磁盘扫描核心（SPEC F4.5、ADR-06、ADR-07）。
//!
//! 此模块不持有 Tauri 状态：它只在一个已经 canonicalize 的作用域内枚举文件并产出
//! 轻量命中位置。结果的分页和预览文本由命令层完成，避免把十万条行预览常驻在内存中。

use crate::constants::{BINARY_DETECT_SAMPLE, CROSS_FILE_CHUNK_SIZE, TIER_B_MAX_BYTES};
use crate::encoding::{decode, detect, EncodingLabel};
use crate::error::{path_hint, AppError, AppResult};
use crate::search::{compile, SearchOptions};
use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

pub const MAX_RESULTS: usize = 100_000;
pub const MAX_PAGE: usize = CROSS_FILE_CHUNK_SIZE;

#[derive(Debug, Clone)]
pub struct ScanRequest {
    pub scope: PathBuf,
    pub query: String,
    pub options: SearchOptions,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub respect_gitignore: bool,
    pub include_hidden: bool,
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMatch {
    /// 绝对规范化路径仅留在 Rust 会话中；前端永远只收到 `relative_path`。
    pub path: PathBuf,
    pub relative_path: String,
    /// 0 基行号和 UTF-16 列号，和 CodeMirror 的坐标单位一致。
    pub line: usize,
    pub start_column: usize,
    pub end_column: usize,
    pub encoding: EncodingLabel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedPath {
    pub path_hint: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    Binary,
    TooLarge,
    ReadOnly,
    ReadFailed,
    Symlink,
    OutsideScope,
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub matches: Vec<StoredMatch>,
    pub scanned_files: usize,
    pub skipped: Vec<SkippedPath>,
    pub truncated: bool,
}

pub fn scan(
    request: &ScanRequest,
    should_cancel: impl Fn() -> bool + Sync,
) -> AppResult<ScanResult> {
    let scope = request
        .scope
        .canonicalize()
        .map_err(|error| AppError::from_io(&error, &request.scope))?;
    let regex = compile(&request.query, request.options)?;
    let includes = compile_globs(&request.include_globs)?;
    let excludes = compile_globs(&request.exclude_globs)?;
    let paths = collect_paths(
        &scope,
        request,
        includes.as_ref(),
        excludes.as_ref(),
        &should_cancel,
    )?;

    if should_cancel() {
        return Err(AppError::Cancelled);
    }

    let used = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    let outcomes = paths
        .par_iter()
        .map(|path| scan_file(path, &scope, &regex, &used, &truncated, &should_cancel))
        .collect::<Vec<_>>();

    if should_cancel() {
        return Err(AppError::Cancelled);
    }

    let mut result = ScanResult {
        truncated: truncated.load(Ordering::Relaxed),
        ..ScanResult::default()
    };
    for outcome in outcomes {
        match outcome? {
            FileOutcome::Matches(matches) => {
                result.scanned_files += 1;
                result.matches.extend(matches);
            }
            FileOutcome::Skipped(skipped) => result.skipped.push(skipped),
        }
    }
    result.matches.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then(left.line.cmp(&right.line))
            .then(left.start_column.cmp(&right.start_column))
    });
    result
        .skipped
        .sort_by(|left, right| left.path_hint.cmp(&right.path_hint));
    Ok(result)
}

fn collect_paths(
    scope: &Path,
    request: &ScanRequest,
    includes: Option<&GlobSet>,
    excludes: Option<&GlobSet>,
    should_cancel: &impl Fn() -> bool,
) -> AppResult<Vec<PathBuf>> {
    if scope.is_file() {
        return Ok(vec![scope.to_path_buf()]);
    }

    let mut builder = WalkBuilder::new(scope);
    builder
        .follow_links(false)
        .hidden(!request.include_hidden)
        .git_ignore(request.respect_gitignore)
        .git_global(request.respect_gitignore)
        .ignore(request.respect_gitignore)
        .parents(request.respect_gitignore)
        .max_depth((!request.recursive).then_some(1));

    let mut paths = Vec::new();
    for entry in builder.build() {
        if should_cancel() {
            return Err(AppError::Cancelled);
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Some(file_type) => file_type,
            None => continue,
        };
        if !file_type.is_file() || file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let relative = path.strip_prefix(scope).unwrap_or(path);
        if !matches_globs(relative, includes, excludes) {
            continue;
        }
        paths.push(path.to_path_buf());
    }
    Ok(paths)
}

fn scan_file(
    path: &Path,
    scope: &Path,
    regex: &regex::Regex,
    used: &AtomicUsize,
    truncated: &AtomicBool,
    should_cancel: &impl Fn() -> bool,
) -> AppResult<FileOutcome> {
    if should_cancel() {
        return Err(AppError::Cancelled);
    }
    let metadata = match path.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return Ok(FileOutcome::Skipped(skipped(path, SkipReason::ReadFailed))),
    };
    if metadata.len() > TIER_B_MAX_BYTES {
        return Ok(FileOutcome::Skipped(skipped(path, SkipReason::TooLarge)));
    }
    let canonical = match path.canonicalize() {
        Ok(path) if path.starts_with(scope) => path,
        Ok(_) => {
            return Ok(FileOutcome::Skipped(skipped(
                path,
                SkipReason::OutsideScope,
            )))
        }
        Err(_) => return Ok(FileOutcome::Skipped(skipped(path, SkipReason::ReadFailed))),
    };
    let bytes = match std::fs::read(&canonical) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(FileOutcome::Skipped(skipped(path, SkipReason::ReadFailed))),
    };
    if bytes[..bytes.len().min(BINARY_DETECT_SAMPLE)].contains(&0) {
        return Ok(FileOutcome::Skipped(skipped(path, SkipReason::Binary)));
    }

    let detected = detect(&bytes);
    let (text, _) = decode(&bytes, detected.label);
    let relative_path = canonical
        .strip_prefix(scope)
        .unwrap_or(&canonical)
        .to_string_lossy()
        .replace('\\', "/");
    let matches = find_file_matches(
        &text,
        regex,
        canonical,
        relative_path,
        detected.label,
        used,
        truncated,
        should_cancel,
    )?;
    Ok(FileOutcome::Matches(matches))
}

#[allow(clippy::too_many_arguments)]
fn find_file_matches(
    text: &str,
    regex: &regex::Regex,
    path: PathBuf,
    relative_path: String,
    encoding: EncodingLabel,
    used: &AtomicUsize,
    truncated: &AtomicBool,
    should_cancel: &impl Fn() -> bool,
) -> AppResult<Vec<StoredMatch>> {
    let mut out = Vec::new();
    let (mut previous_end, mut line, mut column) = (0, 0, 0);
    for (index, found) in regex.find_iter(text).enumerate() {
        if index % 256 == 0 && should_cancel() {
            return Err(AppError::Cancelled);
        }
        advance_location(&text[previous_end..found.start()], &mut line, &mut column);
        let start_column = column;
        advance_location(&text[found.start()..found.end()], &mut line, &mut column);
        let end_column = if text[found.start()..found.end()].contains('\n') {
            // 跨行正则的结果先指向起始行；终点列在下一行没有展示意义。
            start_column
        } else {
            column
        };
        previous_end = found.end();

        if used
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                (count < MAX_RESULTS).then_some(count + 1)
            })
            .is_err()
        {
            truncated.store(true, Ordering::Relaxed);
            break;
        }
        out.push(StoredMatch {
            path: path.clone(),
            relative_path: relative_path.clone(),
            line,
            start_column,
            end_column,
            encoding,
        });
    }
    Ok(out)
}

fn advance_location(text: &str, line: &mut usize, column: &mut usize) {
    for ch in text.chars() {
        if ch == '\n' {
            *line += 1;
            *column = 0;
        } else {
            *column += ch.len_utf16();
        }
    }
}

fn compile_globs(patterns: &[String]) -> AppResult<Option<GlobSet>> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|_| AppError::UnsupportedFormat {
            syntax: "glob".into(),
            operation: "pathSearch".into(),
        })?);
    }
    builder
        .build()
        .map(Some)
        .map_err(|_| AppError::UnsupportedFormat {
            syntax: "glob".into(),
            operation: "pathSearch".into(),
        })
}

fn matches_globs(path: &Path, includes: Option<&GlobSet>, excludes: Option<&GlobSet>) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    includes.is_none_or(|set| set.is_match(&normalized))
        && excludes.is_none_or(|set| !set.is_match(&normalized))
}

fn skipped(path: &Path, reason: SkipReason) -> SkippedPath {
    SkippedPath {
        path_hint: path_hint(path),
        reason,
    }
}

enum FileOutcome {
    Matches(Vec<StoredMatch>),
    Skipped(SkippedPath),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::{MatchMode, SearchOptions};
    use std::fs;
    use tempfile::tempdir;

    fn request(scope: PathBuf) -> ScanRequest {
        ScanRequest {
            scope,
            query: "needle".into(),
            options: SearchOptions {
                mode: MatchMode::Literal,
                ..SearchOptions::default()
            },
            include_globs: Vec::new(),
            exclude_globs: Vec::new(),
            respect_gitignore: true,
            include_hidden: false,
            recursive: true,
        }
    }

    #[test]
    fn scans_text_but_skips_binary_and_gitignored_files() {
        let temp = tempdir().expect("temp directory");
        // `.gitignore` 只有在 Git 工作树中才生效；这正是生产使用场景。
        fs::create_dir(temp.path().join(".git")).expect("git directory");
        fs::write(temp.path().join(".gitignore"), "ignored.txt\n").expect("ignore file");
        fs::write(temp.path().join("keep.txt"), "needle\n").expect("text file");
        fs::write(temp.path().join("ignored.txt"), "needle\n").expect("ignored text");
        fs::write(temp.path().join("binary.bin"), b"needle\0").expect("binary file");

        let result = scan(&request(temp.path().to_path_buf()), || false).expect("scan");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].relative_path, "keep.txt");
        assert!(result
            .skipped
            .iter()
            .any(|entry| entry.reason == SkipReason::Binary));
    }

    #[test]
    fn applies_include_and_exclude_globs_to_relative_paths() {
        let temp = tempdir().expect("temp directory");
        fs::create_dir(temp.path().join("src")).expect("source directory");
        fs::write(temp.path().join("src").join("a.ts"), "needle").expect("typescript");
        fs::write(temp.path().join("src").join("a.test.ts"), "needle").expect("test");
        let mut args = request(temp.path().to_path_buf());
        args.include_globs = vec!["src/**/*.ts".into()];
        args.exclude_globs = vec!["**/*.test.ts".into()];

        let result = scan(&args, || false).expect("scan");

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].relative_path, "src/a.ts");
    }

    #[test]
    fn returns_utf16_columns_for_non_ascii_content() {
        let temp = tempdir().expect("temp directory");
        fs::write(temp.path().join("sample.txt"), "中😀needle").expect("text");

        let result = scan(&request(temp.path().to_path_buf()), || false).expect("scan");

        assert_eq!(result.matches[0].start_column, 3);
        assert_eq!(result.matches[0].end_column, 9);
    }

    #[test]
    fn cancellation_is_an_error_not_a_partial_result() {
        let temp = tempdir().expect("temp directory");
        fs::write(temp.path().join("sample.txt"), "needle").expect("text");

        let error = scan(&request(temp.path().to_path_buf()), || true).expect_err("cancelled");

        assert!(matches!(error, AppError::Cancelled));
    }
}
