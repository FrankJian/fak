import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { saveMermaidImageFile } from "../ipc/imageExport";
import { defaultMermaidImageName, type MermaidImageFormat } from "../lib/mermaidExport";
import { logger } from "../lib/logger";
import { decorateMermaidFigures } from "./markdownPostProcess";
import { mermaidSvgToPng, serializeMermaidSvg } from "./mermaidImage";

interface MermaidExportOptions {
  contentRef: RefObject<HTMLDivElement | null>;
  documentPath: string | null;
  onDiagramCountChange?: (count: number) => void;
}

export function useMermaidExport({
  contentRef,
  documentPath,
  onDiagramCountChange,
}: MermaidExportOptions) {
  const { t } = useTranslation();
  const labels = useMemo(() => ({
    png: t("markdown.exportPng"),
    svg: t("markdown.exportSvg"),
  }), [t]);
  const [exportFailed, setExportFailed] = useState(false);
  const selectedFigureRef = useRef<HTMLElement | null>(null);
  const exportingRef = useRef(false);

  const decorate = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const count = decorateMermaidFigures(container, labels);
    onDiagramCountChange?.(count);
  }, [contentRef, labels, onDiagramCountChange]);

  useEffect(() => () => onDiagramCountChange?.(0), [onDiagramCountChange]);

  const selectFigure = useCallback((target: HTMLElement) => {
    const figure = target.closest<HTMLElement>(".markdown-mermaid");
    if (figure) selectedFigureRef.current = figure;
  }, []);

  const exportDiagram = useCallback(async (
    format: MermaidImageFormat,
    selected?: HTMLElement | null,
  ): Promise<void> => {
    if (exportingRef.current) return;
    const container = contentRef.current;
    if (!container) return;
    const figures = [...container.querySelectorAll<HTMLElement>(".markdown-mermaid")];
    const preferred = selected ?? selectedFigureRef.current;
    const figure = preferred && figures.includes(preferred) ? preferred : figures[0];
    const svg = figure?.querySelector<SVGSVGElement>("svg");
    if (!figure || !svg) {
      setExportFailed(true);
      return;
    }
    const index = figures.indexOf(figure) + 1;
    const buttons = container.querySelectorAll<HTMLButtonElement>("button[data-mermaid-export]");
    exportingRef.current = true;
    setExportFailed(false);
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const bytes = format === "svg"
        ? new TextEncoder().encode(serializeMermaidSvg(svg))
        : await mermaidSvgToPng(svg);
      await saveMermaidImageFile(
        defaultMermaidImageName(documentPath, index, format),
        format,
        bytes,
      );
    } catch {
      logger.warn("mermaid image export failed");
      setExportFailed(true);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      exportingRef.current = false;
    }
  }, [contentRef, documentPath]);

  return { decorate, exportDiagram, exportFailed, selectFigure };
}
