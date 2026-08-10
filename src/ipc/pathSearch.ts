/**
 * 跨文件查找的会话封装（SPEC F4.5）。
 *
 * 命中分页留在 Rust，避免一次响应携带上千条行预览；调用方在新搜索和面板关闭时
 * 必须 dispose 会话，并在用户按停止时调用 cancel。
 */
import { invoke } from './invoke';
import type { SearchOptions } from './search';

export const PATH_SEARCH_PAGE_SIZE = 200;

export type PathSearchSkipReason =
  | 'binary'
  | 'tooLarge'
  | 'readFailed'
  | 'symlink'
  | 'outsideScope';

export interface PathSearchSkipped {
  pathHint: string;
  reason: PathSearchSkipReason;
}

export interface PathSearchRow {
  /** 相对搜索作用域的路径。 */
  path: string;
  /** 0 基行号与 UTF-16 列号。 */
  line: number;
  startColumn: number;
  endColumn: number;
  preview: string;
  previewStart: number;
  previewEnd: number;
  encoding: string;
}

export interface PathSearchStarted {
  sessionId: string;
  total: number;
  scannedFiles: number;
  skipped: PathSearchSkipped[];
  truncated: boolean;
  firstPage: PathSearchRow[];
}

export interface PathSearchPage {
  offset: number;
  total: number;
  matches: PathSearchRow[];
}

export interface PathSearchRequest {
  /** 文件、目录，或由前端将 glob 收窄后的根目录。 */
  scope: string;
  query: string;
  options: SearchOptions;
  includeGlobs: string[];
  excludeGlobs: string[];
  respectGitignore: boolean;
  includeHidden: boolean;
  recursive: boolean;
}

export function startPathSearch(request: PathSearchRequest): Promise<PathSearchStarted> {
  return invoke<PathSearchStarted>('path_search_start', { args: request });
}

export function fetchPathSearchPage(
  sessionId: string,
  offset: number,
): Promise<PathSearchPage> {
  return invoke<PathSearchPage>('path_search_next', {
    args: { sessionId, offset, limit: PATH_SEARCH_PAGE_SIZE },
  });
}

export function disposePathSearch(sessionId: string): Promise<void> {
  return invoke<void>('path_search_dispose', { sessionId });
}

export function cancelPathSearch(): Promise<void> {
  return invoke<void>('path_search_cancel', {});
}
