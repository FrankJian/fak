export type MermaidImageFormat = "png" | "svg";

export function defaultMermaidImageName(
  documentPath: string | null,
  diagramNumber: number,
  format: MermaidImageFormat,
): string {
  const fileName = documentPath?.split(/[/\\]/).pop() ?? "diagram";
  const stem = fileName.replace(/\.(?:md|markdown)$/i, "").trim() || "diagram";
  return `${stem}-mermaid-${diagramNumber}.${format}`;
}

export function imagePathWithExtension(
  path: string,
  format: MermaidImageFormat,
): string {
  if (path.toLowerCase().endsWith(`.${format}`)) return path;
  return `${path.replace(/\.(?:png|svg)$/i, "")}.${format}`;
}
