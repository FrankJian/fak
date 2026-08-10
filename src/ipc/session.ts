/**
 * 会话保存与恢复（SPEC F1.7 / P2-07）。
 *
 * 前端只送 `documentId` 与行号——完整路径全程留在 Rust 侧（SPEC §10.2），
 * 所以这里的入参与返回值都不含路径。
 */
import { invoke } from "./invoke";
import type { DocumentMeta } from "./documents";

export interface SessionSlot {
  documentId: string;
  /** 0 基光标行 */
  line: number;
  /** 视口首个可见行 */
  topLine: number;
  foldedLines: number[];
  locked: boolean;
}

export interface SessionViewState {
  workspaceRoot: string | null;
  expandedPaths: string[];
  fileTreeOpen: boolean;
  bookmarkPanelOpen: boolean;
  outlinePanelOpen: boolean;
  markdownPreviewMode: "hidden" | "split" | "preview";
}

export interface RestoredDocument {
  meta: DocumentMeta;
  line: number;
  topLine: number;
  active: boolean;
  foldedLines: number[];
  locked: boolean;
}

export interface RestoredSession {
  documents: RestoredDocument[];
  /** 会话里记了、但现在已经打不开的文件数。状态栏提一句就够，不弹对话框 */
  missing: number;
  view: SessionViewState;
}

export function saveSession(
  slots: readonly SessionSlot[],
  activeDocumentId: string | null,
  view: SessionViewState,
): Promise<void> {
  return invoke<void>("save_session", {
    args: { slots, activeDocumentId, view },
  });
}

export function restoreSession(): Promise<RestoredSession> {
  return invoke<RestoredSession>("restore_session");
}
