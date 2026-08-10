/** 文档功能开关只按扩展名判定；后端负责正文解析，不把路径暴露到 IPC。 */
const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkdn)$/i;

export function isMarkdownDocument(pathOrName: string | null | undefined): boolean {
  return pathOrName !== null && pathOrName !== undefined && MARKDOWN_EXTENSION.test(pathOrName);
}
