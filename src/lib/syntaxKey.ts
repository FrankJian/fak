/**
 * 与 Rust `syntax::SyntaxKey::from_file_name` 保持同一套扩展名映射。
 * 状态栏只展示检测结果，高亮仍由后端 tree-sitter 负责。
 */
export type SyntaxKey =
  | 'typeScript'
  | 'tsx'
  | 'javaScript'
  | 'rust'
  | 'python'
  | 'json'
  | 'markdown'
  | 'bash';

/** 工具栏里可手动指定的类型；纯文本是显式覆盖，而不是“没有选择”。 */
export type SyntaxSelection = SyntaxKey | 'plainText';

const SYNTAX_FILE_NAMES: Record<SyntaxSelection, string> = {
  plainText: 'untitled.txt',
  typeScript: 'untitled.ts',
  tsx: 'untitled.tsx',
  javaScript: 'untitled.js',
  rust: 'untitled.rs',
  python: 'untitled.py',
  json: 'untitled.json',
  markdown: 'untitled.md',
  bash: 'untitled.sh',
};

export function syntaxKeyFromFileName(fileName: string): SyntaxKey | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typeScript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javaScript';
    case 'rs':
      return 'rust';
    case 'py':
    case 'pyi':
    case 'pyw':
      return 'python';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return null;
  }
}

/** 让已有的“按文件名判定”工具复用手动类型，不把类型判断散落到 UI。 */
export function syntaxFileName(selection: SyntaxSelection): string {
  return SYNTAX_FILE_NAMES[selection];
}
