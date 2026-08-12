import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import type { DocumentMeta } from "../ipc/documents";
import type { SyncStatus } from "../ipc/editSync";
import type { SearchMatch } from "../ipc/search";
import { useTranslation } from "../i18n/useTranslation";
import { scrollMetrics, scrollTopForProgress } from "../lib/minimap";
import { useAppStore } from "../store/appStore";
import { Breadcrumbs } from "./Breadcrumbs";
import { StickyHeader } from "./StickyHeader";
import { SearchOverviewRuler } from "./SearchOverviewRuler";
import { useChangeMarks } from "./useChangeMarks";
import { Minimap } from "./Minimap";
import { useMinimapDensity } from "./useMinimapDensity";
import { useEditorAppearance } from "./useEditorAppearance";
import { useStickyContext } from "./useStickyContext";
import {
  useEditorView,
  type EditorHandle,
  type EditorStatus,
} from "./useEditorView";

/** 小地图画布高度上限，也就是密度桶数。再高没有信息量。 */
const MINIMAP_BUCKETS = 2_000;

interface EditorPaneProps {
  meta: DocumentMeta;
  filePath: string | null;
  initialText: string;
  initialViewportAnchor?: { line: number; topLine: number };
  initialFoldedLines?: readonly number[];
  onSyncStatusChange: (status: SyncStatus) => void;
  /** 正文变化的通知，供备份调度使用（SPEC F1.6） */
  onEdited?: () => void;
  /** 双击行号切换书签（SPEC F7）。传 0 基行号 */
  onToggleBookmark?: (line: number) => void;
  /** 光标移动或正文变化，供大纲联动使用（SPEC F6） */
  onCursorChange?: (cursor: number, docChanged: boolean) => void;
  /** 光标行列与选区字符数，供状态栏展示（SPEC F10） */
  onEditorStatusChange?: (status: EditorStatus) => void;
  /** 标签切换会销毁当前编辑器，销毁前把光标与视口锚点交给会话缓存。 */
  onViewportAnchorChange?: (anchor: { line: number; topLine: number }) => void;
  onFoldedLinesChange?: (lines: number[]) => void;
  /** 视口首行（0 基），Markdown 预览的滚动同步跟的是它 */
  onTopLineChange?: (topLine: number) => void;
  /** flush 闸门的出口：保存等以 Rust 为准的操作要先 await 它 */
  handleRef: RefObject<EditorHandle | null>;
  searchPositions?: readonly SearchMatch[];
  searchOverviewLength?: number;
  /** 自绘右键菜单（SPEC §889：不用内核自带的） */
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** 仅预览模式隐藏 DOM，但绝不能卸载 CM6，否则会丢失未同步的本地编辑。 */
  visible?: boolean;
}

export function EditorPane({
  meta,
  filePath,
  initialText,
  initialViewportAnchor,
  initialFoldedLines,
  onSyncStatusChange,
  onEdited,
  onToggleBookmark,
  onCursorChange,
  onEditorStatusChange,
  onViewportAnchorChange,
  onFoldedLinesChange,
  onTopLineChange,
  handleRef,
  searchPositions = [],
  searchOverviewLength = 0,
  visible = true,
  onContextMenu,
}: EditorPaneProps) {
  const { t } = useTranslation();
  const appearance = useEditorAppearance();
  const stickyScroll = useAppStore((state) => state.stickyScroll);
  const breadcrumbsOn = useAppStore((state) => state.breadcrumbs);

  // Tier C 只按行号反查大纲，粘性滚动在那一档仍可用（SPEC F3.2 末句）
  const context = useStickyContext({
    documentId: meta.documentId,
    handleRef,
    sticky: stickyScroll,
    breadcrumbs: breadcrumbsOn,
  });

  const noteCursor = useCallback(
    (cursor: number, docChanged: boolean) => {
      onCursorChange?.(cursor, docChanged);
      context.noteCursor(cursor);
    },
    [onCursorChange, context],
  );

  const [topLine, setTopLine] = useState(0);
  const [minimapScroll, setMinimapScroll] = useState({
    progress: 0,
    viewportFraction: 1,
  });

  const containerRef = useEditorView({
    meta,
    initialText,
    initialViewportAnchor,
    initialFoldedLines,
    appearance,
    onSyncStatusChange,
    onEdited,
    onToggleBookmark,
    onCursorChange: noteCursor,
    onEditorStatusChange,
    onViewportAnchorChange,
    onFoldedLinesChange,
    onTopLineChange: (topLine) => {
      context.noteTopLine(topLine);
      setTopLine(topLine);
      onTopLineChange?.(topLine);
    },
    longLineWarningLabel: t("editor.longLineDegraded"),
    handleRef,
  });
  const [gutterWidth, setGutterWidth] = useState(0);

  useEffect(() => {
    const gutters =
      containerRef.current?.querySelector<HTMLElement>(".cm-gutters");
    if (!gutters) return;

    const measure = () =>
      setGutterWidth(Math.ceil(gutters.getBoundingClientRect().width));
    measure();
    // 行号从 99 变成 100、切换行号设置或折叠槽出现时宽度都会变化。
    const observer = new ResizeObserver(measure);
    observer.observe(gutters);
    return () => observer.disconnect();
  }, [containerRef, meta.documentId]);

  const changeMarks = useChangeMarks({
    documentId: meta.documentId,
    documentVersion: meta.documentVersion,
    dirty: meta.dirty,
    handleRef,
  });

  const minimapOn = useAppStore((state) => state.minimap);
  const minimapAutohide = useAppStore((state) => state.minimapAutohide);

  useEffect(() => {
    const scroller =
      containerRef.current?.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const next = scrollMetrics(
        scroller.scrollTop,
        scroller.scrollHeight,
        scroller.clientHeight,
      );
      setMinimapScroll((previous) =>
        previous.progress === next.progress &&
        previous.viewportFraction === next.viewportFraction
          ? previous
          : next,
      );
    };
    const scheduleMeasure = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(measure);
    };
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(scroller);
    const content = scroller.querySelector<HTMLElement>(".cm-content");
    if (content) observer.observe(content);
    measure();
    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, meta.documentId]);
  // Tier A 才画行长度条（SPEC §4.1 能力表），Rust 侧也会再把关一次
  const density = useMinimapDensity(
    meta.documentId,
    meta.documentVersion,
    minimapOn ? MINIMAP_BUCKETS : 0,
    minimapOn && meta.mode === "full",
  );

  return (
    <div
      className={visible ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
    >
      {breadcrumbsOn && (
        <Breadcrumbs
          fileName={meta.fileName}
          filePath={filePath}
          chain={context.breadcrumbs}
          onPick={context.goTo}
          loadSiblings={context.siblingsOf}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <StickyHeader
            chain={context.sticky}
            onPick={context.goTo}
            gutterWidth={gutterWidth}
            topLine={topLine}
          />
          <div
            ref={containerRef}
            className={
              minimapOn
                ? "editor-with-minimap h-full overflow-hidden"
                : "h-full overflow-hidden"
            }
            onContextMenu={onContextMenu}
          />
          <SearchOverviewRuler
            matches={searchPositions}
            documentLength={searchOverviewLength}
          />
          {minimapOn && (
            <Minimap
              totalLines={meta.lineCount}
              scrollProgress={minimapScroll.progress}
              viewportFraction={minimapScroll.viewportFraction}
              density={density}
              matches={searchPositions}
              changes={changeMarks}
              autohide={minimapAutohide}
              onScrollProgress={(progress) => {
                const scroller = handleRef.current?.scrollElement();
                if (!scroller) return;
                scroller.scrollTop = scrollTopForProgress(
                  progress,
                  scroller.scrollHeight,
                  scroller.clientHeight,
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
