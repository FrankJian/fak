/**
 * 备份与崩溃恢复命令的封装层（SPEC F1.6）。
 *
 * 触发时机在前端判定（只有前端知道用户停手了），落盘在 Rust。
 */
import { invoke } from "./invoke";
import type { DocumentMeta, LineEnding } from "./documents";

/** 没写备份的原因。不是错误，是如实回报。 */
export type BackupSkipReason = "notDirty" | "streamMode" | "tooLarge";

export interface BackupOutcome {
  documentId: string;
  written: boolean;
  skipped: BackupSkipReason | null;
  savedAtMs: number | null;
}

export interface BackupMeta {
  documentId: string;
  originalPath: string | null;
  fileName: string;
  encoding: string;
  lineEnding: LineEnding;
  cursor: { line: number; columnUtf16: number } | null;
  documentVersion: number;
  savedAtMs: number;
  contentBytes: number;
}

export interface StartupScan {
  cleanExit: boolean;
  pending: BackupMeta[];
}

export interface RecoveredDocument {
  meta: DocumentMeta;
  originalExists: boolean;
  backedUpAtMs: number;
}

export interface BackupDiffDocuments {
  backup: DocumentMeta;
  disk: DocumentMeta;
  originalExists: boolean;
}

/** 备份状态变更事件名，与 Rust 侧的 `BACKUP_STATE_EVENT` 必须一致。 */
export const BACKUP_STATE_EVENT = "app://backup-state-changed";

export function backupDocument(documentId: string): Promise<BackupOutcome> {
  return invoke<BackupOutcome>("backup_document", { args: { documentId } });
}

export function pendingBackups(): Promise<StartupScan> {
  return invoke<StartupScan>("pending_backups");
}

export function recoverBackup(documentId: string): Promise<RecoveredDocument> {
  return invoke<RecoveredDocument>("recover_backup", { args: { documentId } });
}

export function openBackupDiff(
  documentId: string,
): Promise<BackupDiffDocuments> {
  return invoke<BackupDiffDocuments>("open_backup_diff", {
    args: { documentId },
  });
}

export function discardBackup(documentId: string): Promise<void> {
  return invoke<void>("discard_backup", { args: { documentId } });
}

export function discardAllBackups(): Promise<number> {
  return invoke<number>("discard_all_backups");
}

/** 正常退出前调用，下次启动才不会误判成崩溃（F1.6 步骤 4）。 */
export function markCleanExit(): Promise<void> {
  return invoke<void>("mark_clean_exit");
}
