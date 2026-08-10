import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";
import { isTauriAvailable } from "./invoke";

export type WorkspaceEntryKind = "directory" | "file";

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: WorkspaceEntryKind;
}

export interface WorkspaceIndexProgress {
  sessionId: string;
  indexedFiles: number;
  ready: boolean;
}

export interface WorkspaceIndexMatch {
  relativePath: string;
  fileName: string;
  pinyinInitials: string;
}

export interface WorkspaceIndexPage {
  ready: boolean;
  total: number;
  offset: number;
  matches: WorkspaceIndexMatch[];
}

export type TrashOutcome = "moved" | "unavailable";

/** 惰性读取单层目录；展开节点时才调用，绝不把整棵目录树塞进一次 IPC 响应。 */
export function listDirectory(path: string): Promise<WorkspaceEntry[]> {
  return invoke<WorkspaceEntry[]>("list_directory", { args: { path } });
}

export function watchDirectory(path: string): Promise<string> {
  return invoke<string>("watch_directory", { args: { path } });
}

export function unwatchDirectory(path: string): Promise<void> {
  return invoke<void>("unwatch_directory", { args: { path } });
}

export function unwatchAllDirectories(): Promise<void> {
  return invoke<void>("unwatch_all_directories");
}

export function workspaceIndexStart(
  root: string,
): Promise<{ sessionId: string }> {
  return invoke<{ sessionId: string }>("workspace_index_start", {
    args: { root },
  });
}

export function workspaceIndexQuery(
  sessionId: string,
  query: string,
  offset = 0,
  limit = 100,
): Promise<WorkspaceIndexPage> {
  return invoke<WorkspaceIndexPage>("workspace_index_query", {
    args: { sessionId, query, offset, limit },
  });
}

export function workspaceIndexDispose(sessionId: string): Promise<void> {
  return invoke<void>("workspace_index_dispose", { args: { sessionId } });
}

export function renameWorkspaceEntry(
  root: string,
  path: string,
  name: string,
): Promise<WorkspaceEntry> {
  return invoke<WorkspaceEntry>("rename_workspace_entry", {
    args: { root, path, name },
  });
}

export function moveWorkspaceEntryToTrash(
  root: string,
  path: string,
): Promise<TrashOutcome> {
  return invoke<TrashOutcome>("move_workspace_entry_to_trash", {
    args: { root, path },
  });
}

export function permanentlyDeleteWorkspaceEntry(
  root: string,
  path: string,
): Promise<void> {
  return invoke<void>("permanently_delete_workspace_entry", {
    args: { root, path },
  });
}

export function onWorkspaceDirectoryChanged(
  handler: (path: string) => void,
): () => void {
  if (!isTauriAvailable()) return () => {};
  const unlisten = listen<string>(
    "app://workspace-directory-changed",
    (event) => handler(event.payload),
  );
  return () => void unlisten.then((off) => off());
}

export function onWorkspaceIndexProgress(
  handler: (progress: WorkspaceIndexProgress) => void,
): () => void {
  if (!isTauriAvailable()) return () => {};
  const unlisten = listen<WorkspaceIndexProgress>(
    "app://workspace-index-progress",
    (event) => handler(event.payload),
  );
  return () => void unlisten.then((off) => off());
}
