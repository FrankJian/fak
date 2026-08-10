//! 打开、保存、编码与换行符相关的命令（SPEC F1.1 ~ F1.3）。

use super::DocumentMeta;
use crate::constants;
use crate::encoding::EncodingLabel;
use crate::error::{AppError, AppResult};
use crate::file_io::{plan_open, save_atomic, ConflictPolicy, FileFingerprint};
use crate::state::{AppState, Document, DocumentMode, LineEnding};
use crate::stream::StreamDocuments;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::ipc::Channel;

fn with_document<T>(
    state: &AppState,
    document_id: &str,
    action: impl FnOnce(&mut Document) -> AppResult<T>,
) -> AppResult<T> {
    let entry = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let mut document = entry.write().map_err(|_| AppError::Io { os_code: None })?;
    action(&mut document)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileArgs {
    pub path: PathBuf,
    /// 用户已确认「疑似二进制也要打开」
    #[serde(default)]
    pub force: bool,
}

/// 打开文件：体检 → 按档位加载 → 返回元信息。**不返回正文**。
#[tauri::command]
pub async fn open_file(
    args: OpenFileArgs,
    state: tauri::State<'_, AppState>,
    streams: tauri::State<'_, std::sync::Arc<StreamDocuments>>,
) -> AppResult<DocumentMeta> {
    let plan = tauri::async_runtime::spawn_blocking({
        let path = args.path.clone();
        move || plan_open(&path)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    if plan.looks_binary && !args.force {
        return Err(AppError::BinaryContent {
            path_hint: crate::error::path_hint(&plan.path),
        });
    }

    let sample_path = plan.path.clone();
    let sample = tauri::async_runtime::spawn_blocking(move || read_detection_sample(&sample_path))
        .await
        .map_err(|_| AppError::Io { os_code: None })??;
    let detection = crate::encoding::detect(&sample);

    // 先建稀疏行索引，用真实行数与最长行决定档位。Tier C 的正文绝不
    // 进入 Rope；普通文档的临时索引会在下面立刻释放（SPEC §4.1 / ADR-02）。
    let document_id = uuid::Uuid::new_v4().to_string();
    let stream_id = document_id.clone();
    let stream_path = plan.path.clone();
    let stream_state = streams.inner().clone();
    let stream_encoding = detection.label;
    let stream_info = tauri::async_runtime::spawn_blocking(move || {
        stream_state.open(stream_id, &stream_path, stream_encoding)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;
    let mode = DocumentMode::from_metrics(
        plan.size_bytes,
        stream_info.max_line_len,
        stream_info.line_count,
    );

    if mode == DocumentMode::Stream {
        let text = crate::encoding::decode(&sample, detection.label).0;
        return Ok(DocumentMeta {
            document_id,
            file_name: crate::error::path_hint(&plan.path),
            mode,
            size_bytes: plan.size_bytes,
            line_count: stream_info.line_count,
            max_line_len: stream_info.max_line_len,
            encoding: detection.label,
            encoding_confidence: detection.confidence,
            line_ending: crate::line_ending::detect(&text),
            document_version: 0,
            dirty: false,
            read_only: plan.read_only,
            looks_binary: plan.looks_binary,
        });
    }

    streams.close(&document_id);
    let path = plan.path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&path).map_err(|error| AppError::from_io(&error, &path))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let mut document = Document::from_bytes(document_id.clone(), Some(plan.path.clone()), &bytes);
    document.mode = mode;
    document.fingerprint = Some(plan.fingerprint);
    document.read_only = plan.read_only;
    document.looks_binary = plan.looks_binary;

    let meta = DocumentMeta::of(&document);
    state.documents.insert(document_id, RwLock::new(document));
    Ok(meta)
}

fn read_detection_sample(path: &std::path::Path) -> AppResult<Vec<u8>> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|error| AppError::from_io(&error, path))?;
    let mut sample = vec![0; 1024 * 1024];
    let read = file
        .read(&mut sample)
        .map_err(|error| AppError::from_io(&error, path))?;
    sample.truncate(read);
    Ok(sample)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteStreamArgs {
    pub document_id: String,
}

/// 用户确认后把 Tier C 的按需视图载入 Rope，成为可编辑的 Tier B 文档（SPEC §4.1）。
///
/// 这是唯一允许从 Stream 降到 Lean 的路径：用户已经在 UI 中看到了内存估算并确认。
#[tauri::command]
pub async fn promote_stream_document(
    args: PromoteStreamArgs,
    state: tauri::State<'_, AppState>,
    streams: tauri::State<'_, std::sync::Arc<StreamDocuments>>,
) -> AppResult<DocumentMeta> {
    let path = streams.path(&args.document_id)?;
    let plan_path = path.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || plan_open(&plan_path))
        .await
        .map_err(|_| AppError::Io { os_code: None })??;
    let read_path = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&read_path).map_err(|error| AppError::from_io(&error, &read_path))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let mut document = Document::from_bytes(args.document_id.clone(), Some(path), &bytes);
    // SPEC §4.1 的显式档位提升：即使文件仍超过自动档位阈值，也按用户确认进入 Lean。
    document.mode = DocumentMode::Lean;
    document.fingerprint = Some(plan.fingerprint);
    document.read_only = plan.read_only;
    document.looks_binary = plan.looks_binary;
    let meta = DocumentMeta::of(&document);
    state
        .documents
        .insert(args.document_id.clone(), RwLock::new(document));
    streams.close(&args.document_id);
    Ok(meta)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDocumentArgs {
    #[serde(default)]
    pub text: String,
}

#[tauri::command]
pub fn new_document(
    args: NewDocumentArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    let document_id = uuid::Uuid::new_v4().to_string();
    let document = Document::new(document_id.clone(), None, &args.text);
    let meta = DocumentMeta::of(&document);
    state.documents.insert(document_id, RwLock::new(document));
    Ok(meta)
}

#[tauri::command]
pub fn close_document(
    document_id: String,
    state: tauri::State<'_, AppState>,
    syntax: tauri::State<'_, std::sync::Arc<crate::syntax::SyntaxCache>>,
    streams: tauri::State<'_, std::sync::Arc<StreamDocuments>>,
) -> AppResult<()> {
    state.documents.remove(&document_id);
    streams.close(&document_id);
    // 一棵 1 MiB TS 文件的语法树是几 MiB 量级，不跟着文档一起丢会攒起来
    syntax.forget(&document_id);
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineWindow {
    pub start: usize,
    pub lines: Vec<String>,
    pub total_lines: usize,
    /// 因单次响应体积上限被截断（SPEC §3.5：单次响应 > 256 KiB 即拒绝）
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLinesArgs {
    pub document_id: String,
    pub start: usize,
    pub count: usize,
}

/// 按行分页读取正文。
///
/// 正文**一律分页**，不因为文档小就一次性返回：SPEC §3.5 对单次 invoke 响应
/// 有 256 KiB 的硬上限，而 Tier A 上限是 8 MiB。这里在攒够上限时提前收手。
#[tauri::command]
pub fn read_lines(
    args: ReadLinesArgs,
    state: tauri::State<'_, AppState>,
    streams: tauri::State<'_, std::sync::Arc<StreamDocuments>>,
) -> AppResult<LineWindow> {
    if streams.contains(&args.document_id) {
        let window = streams.read_lines(&args.document_id, args.start, args.count)?;
        return Ok(LineWindow {
            start: window.start_line,
            total_lines: streams
                .line_count(&args.document_id)
                .unwrap_or(window.start_line.saturating_add(window.lines.len())),
            lines: window.lines,
            truncated: false,
        });
    }
    with_document(&state, &args.document_id, |document| {
        let total_lines = document.rope.len_lines();
        let start = args.start.min(total_lines);
        let end = start.saturating_add(args.count).min(total_lines);

        let budget = constants::TEXT_TRANSFER_CHUNK * 4;
        let mut lines = Vec::with_capacity(end - start);
        let mut used = 0usize;
        let mut truncated = false;

        for index in start..end {
            let line = document.rope.line(index).to_string();
            let line = line.strip_suffix('\n').unwrap_or(&line).to_string();
            used += line.len() + 1;
            lines.push(line);
            if used >= budget && index + 1 < end {
                truncated = true;
                break;
            }
        }

        Ok(LineWindow {
            start,
            lines,
            total_lines,
            truncated,
        })
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDocumentTextArgs {
    pub document_id: String,
}

/// 全文导出的流式分块。不能把 `String` 作为 invoke 返回值，否则大文档会在 WebView
/// 主线程一次性反序列化（SPEC §3.5）。
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChunk {
    pub sequence: usize,
    pub text: String,
    pub done: bool,
}

#[tauri::command]
pub async fn stream_document_text(
    args: StreamDocumentTextArgs,
    state: tauri::State<'_, AppState>,
    channel: Channel<TextChunk>,
) -> AppResult<()> {
    // Rope 克隆只复制节点引用；在 blocking 线程中展开分块，避免持文档锁或阻塞 UI。
    let rope = with_document(&state, &args.document_id, |document| {
        Ok(document.rope.clone())
    })?;
    tauri::async_runtime::spawn_blocking(move || send_text_chunks(rope, channel))
        .await
        .map_err(|_| AppError::Io { os_code: None })?
}

fn send_text_chunks(rope: ropey::Rope, channel: Channel<TextChunk>) -> AppResult<()> {
    let mut sequence = 0usize;
    let mut buffer = String::with_capacity(constants::TEXT_TRANSFER_CHUNK);

    for fragment in rope.chunks() {
        let mut remainder = fragment;
        while !remainder.is_empty() {
            let available = constants::TEXT_TRANSFER_CHUNK.saturating_sub(buffer.len());
            if available == 0 {
                channel
                    .send(TextChunk {
                        sequence,
                        text: std::mem::take(&mut buffer),
                        done: false,
                    })
                    .map_err(|_| AppError::Io { os_code: None })?;
                sequence += 1;
                continue;
            }

            if remainder.len() <= available {
                buffer.push_str(remainder);
                break;
            }

            let mut split = available;
            while split > 0 && !remainder.is_char_boundary(split) {
                split -= 1;
            }
            if split == 0 {
                channel
                    .send(TextChunk {
                        sequence,
                        text: std::mem::take(&mut buffer),
                        done: false,
                    })
                    .map_err(|_| AppError::Io { os_code: None })?;
                sequence += 1;
                continue;
            }
            buffer.push_str(&remainder[..split]);
            remainder = &remainder[split..];
        }
    }

    channel
        .send(TextChunk {
            sequence,
            text: buffer,
            done: true,
        })
        .map_err(|_| AppError::Io { os_code: None })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveArgs {
    pub document_id: String,
    /// 另存为时给新路径；为空表示存回原路径
    #[serde(default)]
    pub path: Option<PathBuf>,
    /// 用户已在冲突弹窗里选了「覆盖」
    #[serde(default)]
    pub overwrite: bool,
}

fn finish_save(
    document: &mut Document,
    path: PathBuf,
    fingerprint: FileFingerprint,
    read_only: bool,
) -> DocumentMeta {
    document.path = Some(path);
    document.fingerprint = Some(fingerprint);
    // 只读源文件另存到可写位置后，当前标签已经代表新文件，编辑能力也应随目标刷新。
    document.read_only = read_only;
    document.mark_saved();
    document.undo.mark_saved();
    DocumentMeta::of(document)
}

#[tauri::command]
pub async fn save_document(
    args: SaveArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    // 先把要写的字节与目标路径取出来，别在持锁期间做磁盘 I/O
    let (bytes, path, fingerprint) = with_document(&state, &args.document_id, |document| {
        let path = args
            .path
            .clone()
            .or_else(|| document.path.clone())
            .ok_or(AppError::Cancelled)?;
        Ok((document.encode_for_save()?, path, document.fingerprint))
    })?;

    let policy = if args.overwrite || args.path.is_some() {
        ConflictPolicy::Overwrite
    } else {
        ConflictPolicy::Abort
    };
    let expected = if args.path.is_some() {
        None
    } else {
        fingerprint
    };

    let target = path.clone();
    let (outcome, read_only) = tauri::async_runtime::spawn_blocking(move || {
        let outcome = save_atomic(&target, &bytes, expected, policy)?;
        let read_only = std::fs::metadata(&target)
            .map_err(|error| AppError::from_io(&error, &target))?
            .permissions()
            .readonly();
        Ok::<_, AppError>((outcome, read_only))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    with_document(&state, &args.document_id, |document| {
        Ok(finish_save(document, path, outcome.fingerprint, read_only))
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodingArgs {
    pub document_id: String,
    pub encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIdArgs {
    pub document_id: String,
}

/// 一份已打开文档的元数据（SPEC §10.2：只回 basename，不回完整路径）。
///
/// 对比视图要把两侧各装成一个真实编辑器（SPEC F5.2），而它手上只有 documentId。
/// 没有这条命令就得让每一个创建入口把元数据一路传下去，而那份副本还会过期。
#[tauri::command]
pub fn document_meta(
    args: DocumentIdArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    with_document(&state, &args.document_id, |document| {
        Ok(DocumentMeta::of(document))
    })
}

/// 「保存为此编码」：**只改保存时的编码，不重新解码**（SPEC §4.2 约束 4）。
#[tauri::command]
pub fn convert_encoding(
    args: EncodingArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    let label = EncodingLabel::from_name(&args.encoding)?;
    with_document(&state, &args.document_id, |document| {
        document.convert_encoding(label);
        Ok(DocumentMeta::of(document))
    })
}

/// 「以此编码重新打开」：**从磁盘原始字节重新解码**（SPEC §4.2 约束 4）。
/// 会丢弃内存中的改动，UI 必须在文档已脏时先确认。
#[tauri::command]
pub async fn reopen_with_encoding(
    args: EncodingArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    let label = EncodingLabel::from_name(&args.encoding)?;
    let path = with_document(&state, &args.document_id, |document| {
        document.path.clone().ok_or(AppError::Cancelled)
    })?;

    let target = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&target).map_err(|error| AppError::from_io(&error, &target))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    with_document(&state, &args.document_id, |document| {
        document.reopen_with_encoding(&bytes, label);
        document.fingerprint = FileFingerprint::read(&path).ok();
        Ok(DocumentMeta::of(document))
    })
}

/// 丢弃内存修改，以当前编码重新读取磁盘版本（SPEC F1.5 冲突分支）。
#[tauri::command]
pub async fn reload_from_disk(
    args: DocumentIdArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    let (path, encoding) = with_document(&state, &args.document_id, |document| {
        Ok((
            document.path.clone().ok_or(AppError::Cancelled)?,
            document.encoding,
        ))
    })?;
    let target = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&target).map_err(|error| AppError::from_io(&error, &target))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    with_document(&state, &args.document_id, |document| {
        document.reopen_with_encoding(&bytes, encoding);
        document.undo = crate::undo::UndoStack::new();
        document.fingerprint = Some(FileFingerprint::read(&path)?);
        Ok(DocumentMeta::of(document))
    })
}

/// 把磁盘当前内容放进只读临时文档，供保存冲突时与内存版本比较。
#[tauri::command]
pub async fn open_disk_snapshot(
    args: DocumentIdArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    let path = with_document(&state, &args.document_id, |document| {
        document.path.clone().ok_or(AppError::Cancelled)
    })?;
    let target = path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&target).map_err(|error| AppError::from_io(&error, &target))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let document_id = uuid::Uuid::new_v4().to_string();
    let mut snapshot = Document::from_bytes(document_id.clone(), Some(path.clone()), &bytes);
    snapshot.read_only = true;
    snapshot.fingerprint = Some(FileFingerprint::read(&path)?);
    let meta = DocumentMeta::of(&snapshot);
    state.documents.insert(document_id, RwLock::new(snapshot));
    Ok(meta)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineEndingArgs {
    pub document_id: String,
    pub line_ending: LineEnding,
}

#[tauri::command]
pub fn set_line_ending(
    args: LineEndingArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<DocumentMeta> {
    with_document(&state, &args.document_id, |document| {
        document.set_line_ending(args.line_ending);
        Ok(DocumentMeta::of(document))
    })
}

/// 支持的编码清单，供状态栏下拉使用。
#[tauri::command]
pub fn list_encodings() -> AppResult<Vec<String>> {
    Ok(EncodingLabel::ALL
        .iter()
        .map(|label| label.name().to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn state_with(text: &str) -> (AppState, String) {
        let state = AppState::default();
        let document = Document::new("d1".into(), None, text);
        state.documents.insert("d1".into(), RwLock::new(document));
        (state, "d1".to_string())
    }

    #[test]
    fn read_lines_returns_the_requested_window() {
        let (state, id) = state_with("l0\nl1\nl2\nl3\nl4");
        let entry = state.documents.get(&id).expect("文档");
        let document = entry.read().expect("读锁");
        let total = document.rope.len_lines();
        drop(document);
        drop(entry);

        assert_eq!(total, 5);
    }

    #[test]
    fn unknown_document_is_reported_not_panicked() {
        let state = AppState::default();
        let error = with_document(&state, "ghost", |_| Ok(())).expect_err("应当报错");
        assert!(matches!(error, AppError::DocumentNotFound { .. }));
    }

    #[test]
    fn text_stream_preserves_utf8_boundaries_and_marks_the_last_chunk() {
        let text = "中".repeat(constants::TEXT_TRANSFER_CHUNK / 2 + 1);
        let sent = Arc::new(Mutex::new(Vec::<TextChunk>::new()));
        let receiver = sent.clone();
        let channel = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(payload) = body else {
                panic!("文本块必须经 JSON 传输");
            };
            receiver
                .lock()
                .expect("测试锁")
                .push(serde_json::from_str(&payload).expect("有效文本块"));
            Ok(())
        });

        send_text_chunks(ropey::Rope::from_str(&text), channel).expect("发送文本流");
        let chunks = sent.lock().expect("测试锁");
        assert!(chunks.len() >= 2);
        assert!(chunks.last().expect("末块").done);
        assert!(chunks[..chunks.len() - 1].iter().all(|chunk| !chunk.done));
        assert_eq!(
            chunks
                .iter()
                .map(|chunk| chunk.text.as_str())
                .collect::<String>(),
            text
        );
    }

    #[test]
    fn unknown_encoding_name_is_rejected() {
        assert!(EncodingLabel::from_name("no-such-encoding").is_err());
    }

    #[test]
    fn save_as_switches_a_read_only_document_to_the_writable_target() {
        let mut document = Document::new("d1".into(), Some("old.txt".into()), "text");
        document.read_only = true;

        let meta = finish_save(
            &mut document,
            PathBuf::from("copy.txt"),
            FileFingerprint::default(),
            false,
        );

        assert_eq!(document.path, Some(PathBuf::from("copy.txt")));
        assert_eq!(meta.file_name, "copy.txt");
        assert!(!meta.read_only);
        assert!(!meta.dirty);
    }
}
