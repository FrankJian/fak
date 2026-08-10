//! Tier C 的只读流式变换（SPEC F4、F16）。
//!
//! 源文件始终不改：过滤导出与查找替换都写到用户选择的新路径。预览只保存查询、
//! 源指纹和索引快照，不保存全文；执行时再次顺序扫描并原子落盘。

use crate::encoding::{bom_bytes, decode, encode_fragment};
use crate::error::{AppError, AppResult};
use crate::file_io::{save_atomic_stream, FileFingerprint};
use crate::filter::{FilterEngine, FilterRule};
use crate::line_index::LineIndex;
use crate::search::{compile, parse_escape_sequences, SearchOptions};
use crate::stream::StreamDocuments;
use dashmap::DashMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

const PREVIEW_ROWS: usize = 20;
const PROGRESS_LINE_STEP: usize = 4_096;
const MAX_PREVIEW_SESSIONS: usize = 16;

mod core;
use self::core::{preview_text, replace_line, replacement_for_line, validated_output_path};

#[derive(Default)]
pub struct StreamTransformState {
    previews: DashMap<String, ReplacePlan>,
    running: DashMap<String, CancellationToken>,
}

#[derive(Clone)]
struct ReplacePlan {
    document_id: String,
    index: Arc<LineIndex>,
    fingerprint: FileFingerprint,
    regex: Regex,
    replacement: String,
    options: SearchOptions,
    preserve_case: bool,
    output_bytes: u64,
    replacement_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamProgress {
    pub processed_lines: usize,
    pub total_lines: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStreamReplaceArgs {
    pub document_id: String,
    pub query: String,
    pub replacement: String,
    pub options: SearchOptions,
    pub preserve_case: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamReplaceSample {
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamReplacePreview {
    pub preview_id: String,
    pub replacement_count: usize,
    pub output_bytes: u64,
    pub samples: Vec<StreamReplaceSample>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStreamReplaceArgs {
    pub preview_id: String,
    pub output_path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStreamFilterArgs {
    pub document_id: String,
    pub rules: Vec<FilterRule>,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamTransformReport {
    pub affected_lines: usize,
    pub bytes_written: u64,
}

fn begin(state: &StreamTransformState, document_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    if let Some(previous) = state.running.insert(document_id.to_string(), token.clone()) {
        previous.cancel();
    }
    token
}

fn finish(state: &StreamTransformState, document_id: &str, token: &CancellationToken) {
    state
        .running
        .remove_if(document_id, |_, current| current == token);
}

fn report_progress(channel: &Channel<StreamProgress>, processed: usize, total: usize) {
    if processed.is_multiple_of(PROGRESS_LINE_STEP) || processed == total {
        // 进度接收端关闭不影响正在写入临时文件的正确性。
        let _ = channel.send(StreamProgress {
            processed_lines: processed,
            total_lines: total,
        });
    }
}

#[tauri::command]
pub async fn preview_stream_replace(
    args: PreviewStreamReplaceArgs,
    progress: Channel<StreamProgress>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    transforms: tauri::State<'_, Arc<StreamTransformState>>,
) -> AppResult<StreamReplacePreview> {
    if args.options.multiline {
        return Err(AppError::UnsupportedFormat {
            syntax: "stream".to_string(),
            operation: "multilineReplace".to_string(),
        });
    }
    let regex = compile(&args.query, args.options)?;
    let replacement = if args.options.parse_escapes {
        parse_escape_sequences(&args.replacement)
    } else {
        args.replacement
    };
    let index = streams.index(&args.document_id)?;
    let path = streams.path(&args.document_id)?;
    let fingerprint = FileFingerprint::read(&path)?;
    let token = begin(&transforms, &args.document_id);
    let scan_index = index.clone();
    let scan_regex = regex.clone();
    let scan_replacement = replacement.clone();
    let scan_token = token.clone();
    let total_lines = index.line_count();
    let options = args.options;
    let preserve_original_case = args.preserve_case;
    let joined = tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
        let mut count = 0usize;
        let mut output_bytes = bom_bytes(scan_index.encoding()).len() as u64;
        let mut samples = Vec::new();
        let mut encode_error = None;
        scan_index.for_each_raw_line(0, |line, raw, delimiter, encoding| {
            if scan_token.is_cancelled() {
                return false;
            }
            let text = decode(raw, encoding).0;
            let replacement = replacement_for_line(&scan_replacement, delimiter, encoding);
            let (after, line_count) = replace_line(
                &text,
                &scan_regex,
                &replacement,
                options,
                preserve_original_case,
            );
            count += line_count;
            output_bytes += delimiter.len() as u64;
            if let Some(after) = after {
                match encode_fragment(&after, encoding) {
                    Ok(encoded) => output_bytes += encoded.len() as u64,
                    Err(error) => {
                        encode_error = Some(error);
                        return false;
                    }
                }
                if samples.len() < PREVIEW_ROWS {
                    samples.push(StreamReplaceSample {
                        line,
                        before: preview_text(&text),
                        after: preview_text(&after),
                    });
                }
            } else {
                output_bytes += raw.len() as u64;
            }
            report_progress(&progress, line + 1, total_lines);
            true
        })?;
        if let Some(error) = encode_error {
            return Err(error);
        }
        if scan_token.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        Ok((count, output_bytes, samples))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None });
    finish(&transforms, &args.document_id, &token);
    let (replacement_count, output_bytes, samples) = joined??;
    let current = FileFingerprint::read(&path)?;
    if current != fingerprint {
        return Err(AppError::VersionConflict {
            expected: fingerprint.mtime_ms.unsigned_abs(),
            actual: current.mtime_ms.unsigned_abs(),
        });
    }
    let preview_id = uuid::Uuid::new_v4().to_string();
    if transforms.previews.len() >= MAX_PREVIEW_SESSIONS {
        if let Some(oldest) = transforms
            .previews
            .iter()
            .next()
            .map(|entry| entry.key().clone())
        {
            transforms.previews.remove(&oldest);
        }
    }
    transforms.previews.insert(
        preview_id.clone(),
        ReplacePlan {
            document_id: args.document_id,
            index,
            fingerprint,
            regex,
            replacement,
            options,
            preserve_case: preserve_original_case,
            output_bytes,
            replacement_count,
        },
    );
    Ok(StreamReplacePreview {
        preview_id,
        replacement_count,
        output_bytes,
        samples,
    })
}

#[tauri::command]
pub async fn apply_stream_replace(
    args: ApplyStreamReplaceArgs,
    progress: Channel<StreamProgress>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    transforms: tauri::State<'_, Arc<StreamTransformState>>,
) -> AppResult<StreamTransformReport> {
    let plan = transforms
        .previews
        .get(&args.preview_id)
        .map(|entry| entry.clone())
        .ok_or_else(|| AppError::SessionExpired {
            session_id: args.preview_id.clone(),
        })?;
    let source = streams.path(&plan.document_id)?;
    let output = validated_output_path(&source, &args.output_path)?;
    let current_index = streams.index(&plan.document_id)?;
    if !Arc::ptr_eq(&current_index, &plan.index)
        || FileFingerprint::read(&source)? != plan.fingerprint
    {
        return Err(AppError::VersionConflict {
            expected: plan.fingerprint.mtime_ms.unsigned_abs(),
            actual: FileFingerprint::read(&source)?.mtime_ms.unsigned_abs(),
        });
    }
    let token = begin(&transforms, &plan.document_id);
    let write_token = token.clone();
    let write_plan = plan.clone();
    let source_for_check = source.clone();
    let total_lines = plan.index.line_count();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        save_atomic_stream(&output, write_plan.output_bytes, |writer| {
            writer
                .write_all(bom_bytes(write_plan.index.encoding()))
                .map_err(|error| AppError::from_io(&error, &output))?;
            let mut written = bom_bytes(write_plan.index.encoding()).len() as u64;
            let mut count = 0usize;
            let mut write_error = None;
            write_plan
                .index
                .for_each_raw_line(0, |line, raw, delimiter, encoding| {
                    if write_token.is_cancelled() {
                        return false;
                    }
                    let text = decode(raw, encoding).0;
                    let replacement =
                        replacement_for_line(&write_plan.replacement, delimiter, encoding);
                    let (after, line_count) = replace_line(
                        &text,
                        &write_plan.regex,
                        &replacement,
                        write_plan.options,
                        write_plan.preserve_case,
                    );
                    let body = match after {
                        Some(after) => match encode_fragment(&after, encoding) {
                            Ok(encoded) => encoded,
                            Err(error) => {
                                write_error = Some(error);
                                return false;
                            }
                        },
                        None => raw.to_vec(),
                    };
                    if let Err(error) = writer
                        .write_all(&body)
                        .and_then(|_| writer.write_all(delimiter))
                    {
                        write_error = Some(AppError::from_io(&error, &output));
                        return false;
                    }
                    written += (body.len() + delimiter.len()) as u64;
                    count += line_count;
                    report_progress(&progress, line + 1, total_lines);
                    true
                })?;
            if let Some(error) = write_error {
                return Err(error);
            }
            if write_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            let current = FileFingerprint::read(&source_for_check)?;
            if current != write_plan.fingerprint {
                return Err(AppError::VersionConflict {
                    expected: write_plan.fingerprint.mtime_ms.unsigned_abs(),
                    actual: current.mtime_ms.unsigned_abs(),
                });
            }
            if count != write_plan.replacement_count {
                return Err(AppError::VersionConflict {
                    expected: write_plan.replacement_count as u64,
                    actual: count as u64,
                });
            }
            Ok(written)
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None });
    finish(&transforms, &plan.document_id, &token);
    let outcome = joined??;
    transforms.previews.remove(&args.preview_id);
    Ok(StreamTransformReport {
        affected_lines: plan.replacement_count,
        bytes_written: outcome.bytes_written,
    })
}

#[tauri::command]
pub async fn export_stream_filter(
    args: ExportStreamFilterArgs,
    progress: Channel<StreamProgress>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    transforms: tauri::State<'_, Arc<StreamTransformState>>,
) -> AppResult<StreamTransformReport> {
    let index = streams.index(&args.document_id)?;
    let source = streams.path(&args.document_id)?;
    let output = validated_output_path(&source, &args.output_path)?;
    let fingerprint = FileFingerprint::read(&source)?;
    let engine = FilterEngine::new(&args.rules)?;
    let token = begin(&transforms, &args.document_id);
    let write_token = token.clone();
    let total_lines = index.line_count();
    let expected_size = index.stats(0.0).byte_len;
    let source_for_check = source.clone();
    let matched_count = Arc::new(AtomicUsize::new(0));
    let write_matched_count = matched_count.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        save_atomic_stream(&output, expected_size, |writer| {
            writer
                .write_all(bom_bytes(index.encoding()))
                .map_err(|error| AppError::from_io(&error, &output))?;
            let mut written = bom_bytes(index.encoding()).len() as u64;
            let mut write_error = None;
            index.for_each_raw_line(0, |line, raw, delimiter, encoding| {
                if write_token.is_cancelled() {
                    return false;
                }
                let text = decode(raw, encoding).0;
                if engine.apply_line(line, &text).is_some() {
                    if let Err(error) = writer
                        .write_all(raw)
                        .and_then(|_| writer.write_all(delimiter))
                    {
                        write_error = Some(AppError::from_io(&error, &output));
                        return false;
                    }
                    written += (raw.len() + delimiter.len()) as u64;
                    write_matched_count.fetch_add(1, Ordering::Relaxed);
                }
                report_progress(&progress, line + 1, total_lines);
                true
            })?;
            if let Some(error) = write_error {
                return Err(error);
            }
            if write_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            let current = FileFingerprint::read(&source_for_check)?;
            if current != fingerprint {
                return Err(AppError::VersionConflict {
                    expected: fingerprint.mtime_ms.unsigned_abs(),
                    actual: current.mtime_ms.unsigned_abs(),
                });
            }
            Ok(written)
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None });
    finish(&transforms, &args.document_id, &token);
    let outcome = joined??;
    Ok(StreamTransformReport {
        affected_lines: matched_count.load(Ordering::Relaxed),
        bytes_written: outcome.bytes_written,
    })
}

#[tauri::command]
pub fn cancel_stream_transform(
    document_id: String,
    transforms: tauri::State<'_, Arc<StreamTransformState>>,
) {
    if let Some((_, token)) = transforms.running.remove(&document_id) {
        token.cancel();
    }
}

#[cfg(test)]
mod tests;
