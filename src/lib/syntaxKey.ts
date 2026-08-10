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
