export function fileTypeColor(pathOrName: string): string {
  const extension = pathOrName.split(".").pop()?.toLowerCase() ?? "";

  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "rs",
      "py",
      "go",
      "java",
      "c",
      "cpp",
      "cs",
      "php",
      "kt",
      "swift",
      "sh",
      "ps1",
    ].includes(extension)
  ) {
    return "var(--syntax-keyword)";
  }
  if (["html", "htm", "css", "scss", "less", "xml"].includes(extension)) {
    return "var(--syntax-type)";
  }
  if (["json", "yaml", "yml", "toml", "ini", "csv"].includes(extension)) {
    return "var(--syntax-number)";
  }
  if (["md", "markdown", "txt", "rtf"].includes(extension)) {
    return "var(--syntax-string)";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return "var(--success)";
  }
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension)) {
    return "var(--warning)";
  }
  return "var(--text-tertiary)";
}
