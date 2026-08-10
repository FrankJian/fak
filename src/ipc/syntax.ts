/**
 * 语法高亮的封装层（SPEC ADR-05）。
 *
 * 坐标是 **UTF-16 code unit**，与 CodeMirror 原生一致，前端不做任何换算。
 */
import { invoke } from './invoke';

/** 与 Rust `HIGHLIGHT_NAMES` 一一对应；SPEC §6.3.5 限定最多 5 个色相。 */
export type HighlightCapture =
  | 'keyword'
  | 'string'
  | 'number'
  | 'constant'
  | 'comment'
  | 'type';

export type SyntaxKey = 'typeScript' | 'tsx' | 'javaScript';

export interface HighlightSpan {
  start: number;
  end: number;
  capture: HighlightCapture;
}

export interface BracketSpan {
  start: number;
  end: number;
  level: number;
}

export interface HighlightResult {
  spans: HighlightSpan[];
  brackets: BracketSpan[];
  /** null 表示这份文档没有可用的语法，前端不必再问 */
  syntax: SyntaxKey | null;
  /** 与请求时的文档版本不一致就丢弃：期间又编辑过，区间已经错位了 */
  documentVersion: number;
}

export interface FoldRange {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

export interface FoldRangePage {
  ranges: FoldRange[];
  nextOffset: number | null;
}

export function getHighlightSpans(
  documentId: string,
  start: number,
  end: number,
): Promise<HighlightResult> {
  return invoke<HighlightResult>('get_highlight_spans', {
    args: { documentId, start, end },
  });
}

export function getFoldRanges(
  documentId: string,
  offset: number,
  limit = 1_000,
): Promise<FoldRangePage> {
  return invoke<FoldRangePage>('get_fold_ranges', {
    args: { documentId, offset, limit },
  });
}
