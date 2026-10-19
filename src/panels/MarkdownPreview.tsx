/** Markdown HTML 只由 Rust 解析净化，避免前后端安全规则漂移（SPEC F8.1）。 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type UIEvent } from "react";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { renderMarkdownPreview } from "../ipc/markdown";
import { renderDiagrams, renderMath } from "./markdownPostProcess";
import { useMermaidExport } from "./useMermaidExport";
import { useMarkdownPreviewLinks } from "./useMarkdownPreviewLinks";
import type { MermaidImageFormat } from "../lib/mermaidExport";
import { logger } from "../lib/logger";
import {
  MARKDOWN_SYNC_SCROLL_MS,
  markdownPreviewScrollTop,
  markdownScrollPoints,
  previewTopForSourceLine,
  sourceLineForPreviewTop,
} from "../lib/markdownPreviewScroll";

const RENDER_DEBOUNCE_MS = 140;
/** 模块级缓存跨标签组件重建保留 HTML，避免切回时重复渲染（SPEC F8.1）。 */
const renderedCache = new Map<string, string>();

interface MarkdownPreviewProps {
  documentId: string;
  documentPath: string | null;
  /** 每次正文编辑递增；正文不进 Zustand，避免复制大文本（SPEC P1）。 */
  revision: number;
  /** Tier B 只允许手动刷新，Tier A 才做实时预览（SPEC §4.1）。 */
  autoRefresh: boolean;
  /** 编辑器视口首行（0 基），预览跟着它走（SPEC F8.1 步骤 6） */
  topLine: number;
  sourceScrollProgress: number;
  lineCount: number;
  syncScroll: boolean;
  blockRemoteImages: boolean;
  onOpenDocument: (path: string) => void;
  onPreviewTopLineChange: (line: number) => void;
  onDiagramCountChange?: (count: number) => void;
}

export interface MarkdownPreviewHandle {
  exportCurrentDiagram: (format: MermaidImageFormat) => Promise<void>;
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(function MarkdownPreview({
  documentId,
  documentPath,
  revision,
  autoRefresh,
  topLine,
  sourceScrollProgress,
  lineCount,
  syncScroll,
  blockRemoteImages,
  onOpenDocument,
  onPreviewTopLineChange,
  onDiagramCountChange,
}: MarkdownPreviewProps, ref) {
  const { t } = useTranslation();
  const [html, setHtml] = useState(() => renderedCache.get(documentId) ?? "");
  // 后处理会把源码节点替换为 Mermaid/KaTeX DOM。保持这个 prop 的引用稳定，
  // 否则滚动导致的普通 React 重渲染会再次写入原始 HTML，覆盖已渲染的图。
  const previewMarkup = useMemo(() => ({ __html: html }), [html]);
  const [loading, setLoading] = useState(
    autoRefresh && !renderedCache.has(documentId),
  );
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const { decorate, exportDiagram, exportFailed, selectFigure } = useMermaidExport({
    contentRef,
    documentPath,
    onDiagramCountChange,
  });
  useImperativeHandle(ref, () => ({
    exportCurrentDiagram: (format) => exportDiagram(format),
  }), [exportDiagram]);
  const scrollerRef = useRef<HTMLElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const releaseScrollFrameRef = useRef<number | null>(null);
  const lastPreviewLineRef = useRef<number | null>(null);
  const previewDriveUntilRef = useRef(0);
  const previewSourceLineRef = useRef<number | null>(null);
  const scrollPointsRef = useRef<ReturnType<typeof markdownScrollPoints>>([]);
  const measureScrollPoints = useCallback(() => {
    const container = contentRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-line]"), (anchor) => ({
      line: Number(anchor.dataset.line),
      top: anchor.getBoundingClientRect().top - scrollerTop + scroller.scrollTop,
    }));
    scrollPointsRef.current = markdownScrollPoints(anchors, lineCount, scroller.scrollHeight - scroller.clientHeight);
  }, [lineCount]);

  useEffect(() => {
    const container = contentRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;
    measureScrollPoints();
    const observer = new ResizeObserver(measureScrollPoints);
    observer.observe(container);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [html, loading, measureScrollPoints]);

  const stopScrollAnimation = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (releaseScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(releaseScrollFrameRef.current);
      releaseScrollFrameRef.current = null;
    }
    programmaticScrollRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await renderMarkdownPreview(documentId, blockRemoteImages);
      renderedCache.set(documentId, next);
      if (currentRequest === requestId.current) setHtml(next);
    } catch (error) {
      if (currentRequest === requestId.current) {
        setFailed(true);
        logger.warn("markdown preview render failed", error);
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [documentId, blockRemoteImages]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setTimeout(() => void refresh(), RENDER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [autoRefresh, refresh, revision]);

  const openLink = useMarkdownPreviewLinks({
    contentRef,
    scrollerRef,
    documentPath,
    html,
    onOpenDocument,
    stopScrollAnimation,
  });

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const exportButton = target.closest<HTMLButtonElement>("button[data-mermaid-export]");
    if (exportButton) {
      event.preventDefault();
      const format = exportButton.dataset.mermaidExport;
      if (format === "png" || format === "svg") {
        void exportDiagram(format, exportButton.closest<HTMLElement>(".markdown-mermaid"));
      }
      return;
    }
    selectFigure(target);
    openLink(event);
  };

  // 公式与图表在注入之后就地替换；两者都是动态 import，没用到就不会进包
  useEffect(() => {
    const container = contentRef.current;
    if (!container || html.length === 0) return;
    void renderMath(container).catch((error: unknown) =>
      logger.warn("math post-processing failed", error),
    );
    void renderDiagrams(container)
      .then(decorate)
      .catch((error: unknown) => logger.warn("diagram post-processing failed", error));
  }, [html, decorate]);

  // 源码滚到第几行，预览就平滑跟到带那个行号的锚点。每次新目标都会
  // 从当前位置重定向，连续滚动时不会积压一长串动画。
  useEffect(() => {
    if (!syncScroll || loading || failed) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (performance.now() < previewDriveUntilRef.current) {
      previewSourceLineRef.current = topLine;
      return;
    }
    if (lastPreviewLineRef.current === topLine || previewSourceLineRef.current === topLine) {
      return;
    }
    lastPreviewLineRef.current = null;
    previewSourceLineRef.current = null;
    const target = sourceScrollProgress >= 0.999
      ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      : previewTopForSourceLine(topLine, scrollPointsRef.current);
    stopScrollAnimation();
    programmaticScrollRef.current = true;
    if (
      Math.abs(target - scroller.scrollTop) < 1 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      scroller.scrollTop = target;
      releaseScrollFrameRef.current = window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        releaseScrollFrameRef.current = null;
      });
      return;
    }

    const start = scroller.scrollTop;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      scroller.scrollTop = markdownPreviewScrollTop(start, target, elapsed);
      if (elapsed >= MARKDOWN_SYNC_SCROLL_MS) {
        scroller.scrollTop = target;
        scrollFrameRef.current = null;
        releaseScrollFrameRef.current = window.requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
          releaseScrollFrameRef.current = null;
        });
        return;
      }
      scrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    scrollFrameRef.current = window.requestAnimationFrame(tick);
    return stopScrollAnimation;
  }, [
    syncScroll,
    topLine,
    sourceScrollProgress,
    html,
    loading,
    failed,
    stopScrollAnimation,
  ]);

  const handlePreviewScroll = (event: UIEvent<HTMLElement>) => {
    if (!syncScroll || programmaticScrollRef.current) return;
    const line = sourceLineForPreviewTop(event.currentTarget.scrollTop, scrollPointsRef.current);
    lastPreviewLineRef.current = line;
    previewDriveUntilRef.current = performance.now() + 220;
    onPreviewTopLineChange(line);
  };

  useEffect(() => stopScrollAnimation, [stopScrollAnimation]);

  return (
    <aside
      ref={scrollerRef}
      aria-label={t("markdown.preview")}
      className="markdown-preview min-h-0 min-w-0 flex-1 overflow-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)]"
      onClick={handleClick}
      onPointerOver={(event) => selectFigure(event.target as HTMLElement)}
      onFocusCapture={(event) => selectFigure(event.target as HTMLElement)}
      onPointerDown={stopScrollAnimation}
      onWheel={stopScrollAnimation}
      onScroll={handlePreviewScroll}
    >
      {!autoRefresh && (
        <div className="flex h-[var(--h-toolbar)] items-center justify-between border-b border-[var(--border-subtle)] px-[var(--space-2)]">
          <span className="text-[var(--text-secondary)]">
            {t("markdown.manualRefresh")}
          </span>
          <IconButton
            icon="reload"
            label={t("markdown.refresh")}
            onClick={() => void refresh()}
          />
        </div>
      )}
      {loading && (
        <div className="p-[var(--space-3)] text-[var(--text-secondary)]">
          {t("markdown.loading")}
        </div>
      )}
      {failed && (
        <div className="p-[var(--space-3)] text-[var(--danger)]">
          {t("markdown.failed")}
        </div>
      )}
      {exportFailed && (
        <div role="alert" className="p-[var(--space-2)] text-[var(--danger)]">
          {t("markdown.exportFailed")}
        </div>
      )}
      {!loading && !failed && (
        <div
          ref={contentRef}
          className="markdown-preview-content"
          // Rust renders and sanitizes once before this injection (SPEC F8.1).
          dangerouslySetInnerHTML={previewMarkup}
        />
      )}
    </aside>
  );
});
