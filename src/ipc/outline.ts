/**
 * 大纲的封装层（SPEC F6、F3.2）。
 *
 * 返回的是**扁平数组 + depth**，不是嵌套结构：侧栏要虚拟滚动，
 * 嵌套结构每展开一次都得重新拍平一遍；折叠只需按 depth 跳过后续更深的条目。
 */
import { invoke } from "./invoke";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "enum"
  | "constant"
  | "type"
  | "module"
  | "heading"
  | "key"
  | "property";

export interface OutlineNode {
  name: string;
  kind: SymbolKind;
  /** 缩进层级，0 是顶层 */
  depth: number;
  /** 定义所在行，0 基 */
  line: number;
  /** 定义整体的 UTF-16 区间，用于「光标在哪个符号里」的反向定位 */
  start: number;
  end: number;
}

export interface OutlineResult {
  /** `null` 表示这门语言还没有大纲支持——UI 要说明原因，不能只给空列表 */
  syntax: string | null;
  symbols: OutlineNode[];
  /** 撞上符号数上限被截断 */
  truncated: boolean;
  documentVersion: number;
}

export function getOutline(documentId: string): Promise<OutlineResult> {
  return invoke<OutlineResult>("get_outline", { args: { documentId } });
}

/** SPEC F3.2：粘性滚动最多显示 3 层外层符号。 */
export const STICKY_MAX_DEPTH = 3;

/** 光标所处的祖先符号链，最外层在前（SPEC F3.2、§3.6）。 */
export function getStickyContext(
  documentId: string,
  cursor: number,
  maxDepth = STICKY_MAX_DEPTH,
): Promise<OutlineNode[]> {
  return invoke<OutlineNode[]>("get_sticky_context", {
    args: { documentId, cursor, maxDepth },
  });
}

/**
 * 某个符号的同级符号，按文档序（SPEC F3.2 面包屑下拉）。
 *
 * 用定义起点而不是行号定位：同一行上可能有多个定义，行号不唯一。
 * 符号已不在（两次请求之间大纲重算过）时返回空列表。
 */
export function getSymbolSiblings(
  documentId: string,
  start: number,
): Promise<OutlineNode[]> {
  return invoke<OutlineNode[]>("get_symbol_siblings", {
    args: { documentId, start },
  });
}
