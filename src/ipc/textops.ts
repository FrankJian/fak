/**
 * 文本处理工具的封装层（SPEC F9）。
 *
 * 统计在 Rust 侧算（SPEC P2）：几 MB 的正文在前端分词会把渲染线程占满，
 * 而回传的只是几个数字。
 */
import { invoke } from "./invoke";
import type { ReplaceEdit } from "./search";

export interface Selection {
  from: number;
  to: number;
}

export interface WordCount {
  /** CJK 按字计，西文按空白分词 */
  words: number;
  characters: number;
  charactersNoSpaces: number;
  lines: number;
  paragraphs: number;
  /** UTF-8 字节数；落盘大小还要看编码 */
  bytes: number;
}

/** 有选区时只统计选区，否则统计全文（SPEC F9 步骤 7）。 */
export function countWords(
  documentId: string,
  selection?: Selection,
): Promise<WordCount> {
  return invoke<WordCount>("count_document_words", {
    args: { documentId, selection: selection ?? null },
  });
}

/** 与 Rust `LineTool` 一一对应（SPEC F3.3 的「编辑」与「排序」子菜单）。 */
export type LineTool =
  | "removeEmptyLines"
  | "removeDuplicateLines"
  | "trimStart"
  | "trimEnd"
  | "trimBoth"
  | "sortAscending"
  | "sortDescending"
  | "sortAscendingIgnoreCase"
  | "sortDescendingIgnoreCase"
  | "sortPinyinAscending"
  | "sortPinyinDescending"
  | "uppercase"
  | "lowercase"
  | "titleCase"
  | "camelCase"
  | "snakeCase"
  | "kebabCase";

export type Base64Direction = "encode" | "decode";

/** 与 Rust `FormatSyntax` 一一对应（SPEC F9.1）。 */
export type FormatSyntax = "json" | "jsonc" | "yaml" | "xml" | "html" | "toml";

export type IndentTool = "tabsToSpaces" | "spacesToTabs";

/** 按文件名猜格式化语法；猜不出来时返回 null，由调用方禁用入口而不是乱猜。 */
export function formatSyntaxOf(fileName: string | null): FormatSyntax | null {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "json") return "json";
  if (ext === "jsonc") return "jsonc";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (["xml", "xsd", "xsl", "xslt", "svg"].includes(ext)) return "xml";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "toml") return "toml";
  return null;
}

/** 格式化 / 压缩整个文档（SPEC F9.1）。回传最小编辑集。 */
export function planFormat(
  documentId: string,
  syntax: FormatSyntax,
  options: { minify: boolean; indentWidth: number; useTabs: boolean },
): Promise<ReplaceEdit[]> {
  return invoke<ReplaceEdit[]>("plan_format", {
    args: { documentId, syntax, ...options },
  });
}

/** Tab ↔ 空格转换（SPEC F9.2）。只动行首缩进。 */
export function planIndentTool(
  documentId: string,
  tool: IndentTool,
  tabWidth: number,
  selection?: Selection,
): Promise<ReplaceEdit[]> {
  return invoke<ReplaceEdit[]>("plan_indent_tool", {
    args: { documentId, tool, tabWidth, selection: selection ?? null },
  });
}

/**
 * 算出按行工具要落到文档上的改动，交由调用方**当作一次编辑批次**下发。
 *
 * 与「替换全部」同构：走普通编辑路径才能自动获得撤销栈、版本号与备份触发，
 * 且一批编辑本就是一个撤销步骤。
 * Rust 回传的是**最小改动**而不是整段新文本，否则一篇几 MB 的文档会撞穿
 * SPEC §3.5 的单次响应上限。
 */
export function planLineTool(
  documentId: string,
  tool: LineTool,
  selection?: Selection,
): Promise<ReplaceEdit[]> {
  return invoke<ReplaceEdit[]>("plan_line_tool", {
    args: { documentId, tool, selection: selection ?? null },
  });
}

/** Base64 编解码并替换选区（SPEC F3.3 「转换」子菜单）。 */
export function planBase64(
  documentId: string,
  direction: Base64Direction,
  selection?: Selection,
): Promise<ReplaceEdit[]> {
  return invoke<ReplaceEdit[]>("plan_base64", {
    args: { documentId, direction, selection: selection ?? null },
  });
}

/** 只算结果不改文档，供「复制 Base64 编码 / 解码结果」用。 */
export function transcodeBase64(
  documentId: string,
  direction: Base64Direction,
  selection?: Selection,
): Promise<string> {
  return invoke<string>("transcode_base64", {
    args: { documentId, direction, selection: selection ?? null },
  });
}
