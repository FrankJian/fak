/** 跨文件替换预览与确认落盘（SPEC F4.6）。 */
import { invoke } from './invoke';
import type { PathSearchRequest, PathSearchSkipped } from './pathSearch';

export interface PathReplacementPreview {
  index: number;
  line: number;
  before: string;
  after: string;
}

export interface PathReplaceFilePreview {
  path: string;
  replacements: PathReplacementPreview[];
}

export interface PathReplacePreview {
  sessionId: string;
  files: PathReplaceFilePreview[];
  fileCount: number;
  replacementCount: number;
  skipped: PathSearchSkipped[];
}

export interface SelectedReplaceFile {
  path: string;
  replacementIndexes: number[];
}

export interface PathReplaceReport {
  changedFiles: number;
  changedReplacements: number;
  skipped: PathSearchSkipped[];
}

export function previewPathReplace(
  request: PathSearchRequest & { replacement: string },
): Promise<PathReplacePreview> {
  return invoke<PathReplacePreview>('path_replace_preview', { args: request });
}

export function applyPathReplace(
  sessionId: string,
  selected: SelectedReplaceFile[],
): Promise<PathReplaceReport> {
  return invoke<PathReplaceReport>('path_replace_apply', {
    args: { sessionId, selected },
  });
}
