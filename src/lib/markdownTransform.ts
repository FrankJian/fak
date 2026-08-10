/**
 * Markdown 格式化只产出一个替换和新选区；由 CodeMirror 在单一事务中应用，
 * 因而工具栏点击是一个撤销步骤（SPEC F8.3）。
 */
export type MarkdownFormat =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "codeBlock"
  | "quote"
  | "unorderedList"
  | "orderedList"
  | "taskList"
  | "link"
  | "image"
  | "table"
  | "rule"
  | "heading"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "indent"
  | "outdent"
  | "subscript"
  | "superscript";

export interface MarkdownSelection {
  from: number;
  to: number;
}

export interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
  selection: MarkdownSelection;
}

function selectionEdit(
  selection: MarkdownSelection,
  prefix: string,
  suffix: string,
  placeholder: string,
  text: string,
): MarkdownEdit {
  const selected = text.slice(selection.from, selection.to);
  if (selected.startsWith(prefix) && selected.endsWith(suffix)) {
    const unwrapped = selected.slice(
      prefix.length,
      selected.length - suffix.length,
    );
    return {
      from: selection.from,
      to: selection.to,
      insert: unwrapped,
      selection: {
        from: selection.from,
        to: selection.from + unwrapped.length,
      },
    };
  }
  const body = selected || placeholder;
  return {
    from: selection.from,
    to: selection.to,
    insert: `${prefix}${body}${suffix}`,
    selection: {
      from: selection.from + prefix.length,
      to: selection.from + prefix.length + body.length,
    },
  };
}

function lineEdit(
  selection: MarkdownSelection,
  text: string,
  prefix: string,
  placeholder: string,
): MarkdownEdit {
  const lineStart = text.lastIndexOf("\n", Math.max(selection.from - 1, 0)) + 1;
  const lineEndAtSelection = text.indexOf("\n", selection.to);
  const lineEnd = lineEndAtSelection === -1 ? text.length : lineEndAtSelection;
  const source = text.slice(lineStart, lineEnd) || placeholder;
  const lines = source.split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));
  const next = allPrefixed
    ? lines.map((line) => line.slice(prefix.length)).join("\n")
    : lines.map((line) => `${prefix}${line}`).join("\n");
  return {
    from: lineStart,
    to: lineEnd,
    insert: next,
    selection: { from: lineStart, to: lineStart + next.length },
  };
}

/**
 * 取消缩进：每行最多去掉两个空格，已经靠左的行原样不动。
 *
 * 不用 `lineEdit` 的 toggle 语义：那条路在「并非每行都有缩进」时会改成加缩进，
 * 而用户点的是「减少缩进」。
 */
function outdentEdit(selection: MarkdownSelection, text: string): MarkdownEdit {
  const lineStart = text.lastIndexOf("\n", Math.max(selection.from - 1, 0)) + 1;
  const lineEndAtSelection = text.indexOf("\n", selection.to);
  const lineEnd = lineEndAtSelection === -1 ? text.length : lineEndAtSelection;
  const source = text.slice(lineStart, lineEnd);
  const next = source
    .split("\n")
    .map((line) =>
      line.startsWith("  ") ? line.slice(2) : line.replace(/^ /, ""),
    )
    .join("\n");
  return {
    from: lineStart,
    to: lineEnd,
    insert: next,
    selection: { from: lineStart, to: lineStart + next.length },
  };
}

/**
 * 回到正文：去掉行首的 `#` 标题标记。
 *
 * 不用 `lineEdit` 的 toggle 语义——那条路在「已经是正文」时会反过来加标记，
 * 而用户按的是「设为正文」，该是幂等的。
 */
function paragraphEdit(
  selection: MarkdownSelection,
  text: string,
): MarkdownEdit {
  const lineStart = text.lastIndexOf("\n", Math.max(selection.from - 1, 0)) + 1;
  const lineEndAtSelection = text.indexOf("\n", selection.to);
  const lineEnd = lineEndAtSelection === -1 ? text.length : lineEndAtSelection;
  const next = text
    .slice(lineStart, lineEnd)
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, ""))
    .join("\n");
  return {
    from: lineStart,
    to: lineEnd,
    insert: next,
    selection: { from: lineStart, to: lineStart + next.length },
  };
}

export function markdownTransform(
  format: MarkdownFormat,
  text: string,
  selection: MarkdownSelection,
): MarkdownEdit {
  switch (format) {
    case "bold":
      return selectionEdit(selection, "**", "**", "bold text", text);
    case "italic":
      return selectionEdit(selection, "*", "*", "italic text", text);
    case "strikethrough":
      return selectionEdit(selection, "~~", "~~", "strikethrough text", text);
    case "inlineCode":
      return selectionEdit(selection, "`", "`", "code", text);
    case "codeBlock":
      return selectionEdit(selection, "```\n", "\n```", "code", text);
    case "quote":
      return lineEdit(selection, text, "> ", "quote");
    case "unorderedList":
      return lineEdit(selection, text, "- ", "list item");
    case "orderedList":
      return lineEdit(selection, text, "1. ", "list item");
    case "taskList":
      return lineEdit(selection, text, "- [ ] ", "task");
    case "heading":
      return lineEdit(selection, text, "# ", "heading");
    case "paragraph":
      return paragraphEdit(selection, text);
    case "heading1":
      return lineEdit(selection, text, "# ", "heading");
    case "heading2":
      return lineEdit(selection, text, "## ", "heading");
    case "heading3":
      return lineEdit(selection, text, "### ", "heading");
    case "heading4":
      return lineEdit(selection, text, "#### ", "heading");
    case "heading5":
      return lineEdit(selection, text, "##### ", "heading");
    case "heading6":
      return lineEdit(selection, text, "###### ", "heading");
    case "indent":
      return lineEdit(selection, text, "  ", "text");
    case "outdent":
      return outdentEdit(selection, text);
    // GFM 不定义上下标，但 `~x~` / `^x^` 是流行扩展里最通用的写法；
    // 换成内联 HTML 会被渲染器转义成可见文本（SPEC F8.1）
    case "subscript":
      return selectionEdit(selection, "~", "~", "subscript", text);
    case "superscript":
      return selectionEdit(selection, "^", "^", "superscript", text);
    case "link":
      return selectionEdit(selection, "[", "](https://)", "链接文字", text);
    case "image":
      return selectionEdit(selection, "![", "](https://)", "图片说明", text);
    case "table": {
      const insert = "| Header |\n| --- |\n| Content |";
      return {
        from: selection.from,
        to: selection.to,
        insert,
        selection: { from: selection.from, to: selection.from + insert.length },
      };
    }
    case "rule": {
      const insert = "\n---\n";
      return {
        from: selection.from,
        to: selection.to,
        insert,
        selection: { from: selection.from, to: selection.from + insert.length },
      };
    }
  }
}
