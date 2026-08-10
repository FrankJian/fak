/**
 * Markdown HTML 只来自 Rust 的 `render_markdown_preview`：它完成解析与净化，
 * 这里绝不重新净化或自行解析，以免两套安全规则漂移（SPEC F8.1）。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { renderMarkdownPreview } from "../ipc/markdown";
import { openExternalUrl } from "../ipc/opener";
import { assetUrl } from "../ipc/assets";
import { isTauriAvailable } from "../ipc/invoke";
import { renderDiagrams, renderMath } from "./markdownPostProcess";
import { logger } from "../lib/logger";

const RENDER_DEBOUNCE_MS = 140;

/**
 * 按标签缓存已渲染的 HTML（SPEC F8.1）。
 *
 * 模块级而不是组件 state：切回上一个标签时组件已经重建了，
 * 放在 state 里的缓存随之丢失，每次切标签都要白白重渲染一次。
 */
const renderedCache = new Map<string, string>();

interface MarkdownPreviewProps {
  documentId: string;
  /** 每次正文编辑递增；正文不进 Zustand，避免复制大文本（SPEC P1）。 */
  revision: number;
  /** Tier B 只允许手动刷新，Tier A 才做实时预览（SPEC §4.1）。 */
  autoRefresh: boolean;
  /** 编辑器视口首行（0 基），预览跟着它走（SPEC F8.1 步骤 6） */
  topLine: number;
  syncScroll: boolean;
  blockRemoteImages: boolean;
}

export function MarkdownPreview({
  documentId,
  revision,
  autoRefresh,
  topLine,
  syncScroll,
  blockRemoteImages,
}: MarkdownPreviewProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState(() => renderedCache.get(documentId) ?? "");
  const [loading, setLoading] = useState(
    autoRefresh && !renderedCache.has(documentId),
  );
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);

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

  const openLink = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    void openExternalUrl(href).catch((error: unknown) =>
      logger.warn("opening preview link failed", error),
    );
  };

  // Rust 已校验过路径在文档目录之内；这里只做协议转换，不再自己拼路径
  useEffect(() => {
    if (!isTauriAvailable()) return;
    const container = contentRef.current;
    if (!container) return;
    for (const image of container.querySelectorAll<HTMLImageElement>(
      "img[data-local-src]",
    )) {
      const path = image.dataset.localSrc;
      if (!path) continue;
      image.src = assetUrl(path);
      delete image.dataset.localSrc;
    }
  }, [html]);

  // 公式与图表在注入之后就地替换；两者都是动态 import，没用到就不会进包
  useEffect(() => {
    const container = contentRef.current;
    if (!container || html.length === 0) return;
    void renderMath(container).catch((error: unknown) =>
      logger.warn("math post-processing failed", error),
    );
    void renderDiagrams(container).catch((error: unknown) =>
      logger.warn("diagram post-processing failed", error),
    );
  }, [html]);

  // 源码滚到第几行，预览就滚到带那个行号的锚点
  useEffect(() => {
    if (!syncScroll || loading || failed) return;
    const container = contentRef.current;
    const scroller = scrollerRef.current;
    if (!container || !scroller) return;
    const anchor = nearestAnchor(container, topLine + 1);
    if (!anchor) return;
    scroller.scrollTo({
      top:
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top,
    });
  }, [syncScroll, topLine, html, loading, failed]);

  return (
    <aside
      ref={scrollerRef}
      aria-label={t("markdown.preview")}
      className="markdown-preview min-h-0 min-w-0 flex-1 overflow-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)]"
      onClick={openLink}
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
      {!loading && !failed && (
        <div
          ref={contentRef}
          className="markdown-preview-content"
          // Rust renders and sanitizes once before this injection (SPEC F8.1).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </aside>
  );
}

/** 找到行号不超过 `line` 的最后一个锚点：块之间的行落在它所属的块上。 */
function nearestAnchor(
  container: HTMLElement,
  line: number,
): HTMLElement | null {
  const anchors = container.querySelectorAll<HTMLElement>("[data-line]");
  let best: HTMLElement | null = null;
  for (const anchor of anchors) {
    if (Number(anchor.dataset.line) <= line) best = anchor;
    else break;
  }
  return best;
}
