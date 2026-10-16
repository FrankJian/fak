/** 预览中的相对 Markdown 链接以当前文档目录为基准，不交给 WebView 导航。 */
export function resolveMarkdownLink(documentPath: string | null, href: string): string | null {
  if (!documentPath) return null;
  const normalizedDocument = documentPath.replace(/\\/g, "/");
  const slash = normalizedDocument.lastIndexOf("/");
  if (slash < 0) return null;
  return resolveMarkdownLinkFromDirectory(documentPath.slice(0, slash), href);
}

export function resolveMarkdownLinkFromDirectory(directory: string, href: string): string | null {
  const rawPath = href.split(/[?#]/, 1)[0];
  if (!rawPath) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (/^[\\/]/.test(decoded) || decoded.includes(":") ||
      Array.from(decoded).some((char) => char.charCodeAt(0) < 32)) return null;
  if (!/\.(md|markdown)$/i.test(decoded)) return null;
  const parts = directory.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  const rootDepth = parts[0] === "" && parts[1] === "" ? 4 : 1;
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length <= rootDepth) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const result = parts.join("/");
  return directory.includes("\\") ? result.replace(/\//g, "\\") : result;
}

/** Markdown 的 # 标题链接优先匹配显式 id，再匹配标题文本生成的常见 slug。 */
export function findMarkdownFragmentTarget(container: HTMLElement, href: string): HTMLElement | null {
  if (!href.startsWith("#") || href.length < 2) return null;
  let fragment: string;
  try {
    fragment = decodeURIComponent(href.slice(1));
  } catch {
    return null;
  }
  const byId = Array.from(container.querySelectorAll<HTMLElement>("[id]"))
    .find((node) => node.id === fragment);
  if (byId) return byId;
  return Array.from(container.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))
    .find((heading) => heading.textContent?.toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") === fragment.toLowerCase()) ?? null;
}
