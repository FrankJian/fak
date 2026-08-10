/**
 * 文档相关命令的封装层。组件一律经这里调用，不直接 invoke（AGENTS.md §5.2）。
 *
 * 坐标约定：`from` / `to` 是 **UTF-16 code unit 偏移**（CodeMirror 的原生坐标），
 * 换算成 char 偏移由 Rust 侧用 rope 完成。前端不做这个换算。
 */
import { Channel } from "@tauri-apps/api/core";
import { invoke } from "./invoke";

export type DocumentMode = "full" | "lean" | "stream";
export type LineEnding = "lf" | "crLf" | "cr";
export type EncodingConfidence = "high" | "medium" | "low";

export interface DocumentMeta {
  documentId: string;
  fileName: string;
  mode: DocumentMode;
  sizeBytes: number;
  lineCount: number;
  maxLineLen: number;
  encoding: string;
  encodingConfidence: EncodingConfidence;
  lineEnding: LineEnding;
  documentVersion: number;
  dirty: boolean;
  readOnly: boolean;
  looksBinary: boolean;
}

export interface LineWindow {
  start: number;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

interface TextStreamChunk {
  sequence: number;
  text: string;
  done: boolean;
}

export interface ApplyResult {
  documentVersion: number;
  dirty: boolean;
  mode: DocumentMode;
  lineCount: number;
}

export interface UndoResult {
  applied: boolean;
  documentVersion: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** 与 Rust 的 `EditOrigin` 一一对应；它决定撤销栈怎么合并这一步。 */
export type EditOrigin =
  | "typing"
  | "deleting"
  | "paste"
  | "bulkDelete"
  | "format"
  | "replace"
  | "other";

export interface Utf16Change {
  from: number;
  to: number;
  insert: string;
}

export function openFile(path: string, force = false): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("open_file", { args: { path, force } });
}

/** 用户确认内存估算后，把 Tier C mmap 视图提升为可编辑的 Tier B Rope。 */
export function promoteStreamDocument(
  documentId: string,
): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("promote_stream_document", {
    args: { documentId },
  });
}

export function newDocument(text = ""): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("new_document", { args: { text } });
}

export function closeDocument(documentId: string): Promise<void> {
  return invoke<void>("close_document", { documentId });
}

/**
 * 正文一律分页取，不因为文档小就整篇拉过来：
 * SPEC §3.5 对单次 invoke 响应有 256 KiB 硬上限，而 Tier A 上限是 8 MiB。
 */
export function readLines(
  documentId: string,
  start: number,
  count: number,
): Promise<LineWindow> {
  return invoke<LineWindow>("read_lines", {
    args: { documentId, start, count },
  });
}

/** 全文导出走 Channel 分块，避免单次 invoke 响应阻塞 WebView（SPEC §3.5）。 */
export function streamDocumentText(documentId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: string[] = [];
    let expectedSequence = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const channel = new Channel<TextStreamChunk>((chunk) => {
      if (settled) return;
      if (chunk.sequence !== expectedSequence) {
        fail(new Error("Document text stream arrived out of order"));
        return;
      }
      parts.push(chunk.text);
      expectedSequence += 1;
      if (chunk.done) {
        settled = true;
        resolve(parts.join(""));
      }
    });

    void invoke<void>("stream_document_text", {
      args: { documentId },
      channel,
    }).catch(fail);
  });
}

export function saveDocument(
  documentId: string,
  options: { path?: string; overwrite?: boolean } = {},
): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("save_document", {
    args: {
      documentId,
      path: options.path ?? null,
      overwrite: options.overwrite ?? false,
    },
  });
}

/** 「保存为此编码」：只改保存时的字节编码，正文不动（SPEC §4.2 约束 4）。 */
export function convertEncoding(
  documentId: string,
  encoding: string,
): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("convert_encoding", {
    args: { documentId, encoding },
  });
}

/** 「以此编码重新打开」：从磁盘字节重新解码，丢弃未保存修改（SPEC §4.2 约束 4）。 */
export function reopenWithEncoding(
  documentId: string,
  encoding: string,
): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("reopen_with_encoding", {
    args: { documentId, encoding },
  });
}

export function reloadFromDisk(documentId: string): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("reload_from_disk", { args: { documentId } });
}

/** 创建只读磁盘快照，仅供保存冲突的差异视图使用。 */
export function openDiskSnapshot(documentId: string): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("open_disk_snapshot", { args: { documentId } });
}

/** 按 id 取元数据。对比视图只拿得到 documentId，却要据此装出真实编辑器。 */
export function documentMeta(documentId: string): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("document_meta", { args: { documentId } });
}

export function setLineEnding(
  documentId: string,
  lineEnding: LineEnding,
): Promise<DocumentMeta> {
  return invoke<DocumentMeta>("set_line_ending", {
    args: { documentId, lineEnding },
  });
}

export function listEncodings(): Promise<string[]> {
  return invoke<string[]>("list_encodings");
}

export function applyEdits(
  documentId: string,
  baseVersion: number,
  changes: Utf16Change[],
  origin: EditOrigin,
): Promise<ApplyResult> {
  return invoke<ApplyResult>("apply_edits", {
    args: { documentId, baseVersion, changes, origin },
  });
}

export function undo(documentId: string): Promise<UndoResult> {
  return invoke<UndoResult>("undo", { args: { documentId } });
}

export function redo(documentId: string): Promise<UndoResult> {
  return invoke<UndoResult>("redo", { args: { documentId } });
}

export function resync(documentId: string, text: string): Promise<ApplyResult> {
  return invoke<ApplyResult>("resync", { args: { documentId, text } });
}

/** 分页把整篇取回来。仅用于 Tier A / B 装载编辑器。 */
export async function readAllText(
  documentId: string,
  totalLines: number,
): Promise<string> {
  const lines: string[] = [];
  let cursor = 0;
  // 有 truncated 兜底，这个上限只是防御死循环
  while (cursor < totalLines && lines.length < totalLines) {
    const window = await readLines(documentId, cursor, 2000);
    if (window.lines.length === 0) break;
    lines.push(...window.lines);
    cursor = window.start + window.lines.length;
  }
  return lines.join("\n");
}
