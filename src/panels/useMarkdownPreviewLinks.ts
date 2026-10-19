import { useEffect, type MouseEvent, type RefObject } from "react";
import { assetUrl } from "../ipc/assets";
import { isTauriAvailable } from "../ipc/invoke";
import { openExternalUrl } from "../ipc/opener";
import { logger } from "../lib/logger";
import {
  findMarkdownFragmentTarget,
  resolveMarkdownLink,
  resolveMarkdownLinkFromDirectory,
} from "../lib/markdownLinks";

interface Options {
  contentRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  documentPath: string | null;
  html: string;
  onOpenDocument: (path: string) => void;
  stopScrollAnimation: () => void;
}

export function useMarkdownPreviewLinks({
  contentRef,
  scrollerRef,
  documentPath,
  html,
  onOpenDocument,
  stopScrollAnimation,
}: Options) {
  // Rust 已校验过路径在文档目录之内；这里只做协议转换。
  useEffect(() => {
    if (!isTauriAvailable()) return;
    const container = contentRef.current;
    if (!container) return;
    for (const image of container.querySelectorAll<HTMLImageElement>("img[data-local-src]")) {
      const path = image.dataset.localSrc;
      if (!path) continue;
      image.src = assetUrl(path);
      delete image.dataset.localSrc;
    }
  }, [contentRef, html]);

  return (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    const localHref = anchor.dataset.localHref;
    if (localHref) {
      const path = documentPath
        ? resolveMarkdownLink(documentPath, localHref)
        : anchor.dataset.localDir
          ? resolveMarkdownLinkFromDirectory(anchor.dataset.localDir, localHref)
          : null;
      if (path) onOpenDocument(path);
      return;
    }
    if (href?.startsWith("#")) {
      const container = contentRef.current;
      const scroller = scrollerRef.current;
      const target = container && findMarkdownFragmentTarget(container, href);
      if (container && scroller && target) {
        stopScrollAnimation();
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      }
      return;
    }
    if (!href) return;
    void openExternalUrl(href).catch(() => logger.warn("opening preview link failed"));
  };
}
