import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import type { DocumentMeta } from "../ipc/documents";
import type { SyncStatus } from "../ipc/editSync";
import type { SearchMatch } from "../ipc/search";
import { useTranslation } from "../i18n/useTranslation";
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
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState(0);

  // 视口指示条的高度直接取决于可见行数，估一个值会让它在不同字号下明显偏
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(([entry]) =>
      setPaneHeight(entry.contentRect.height),
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const lineHeightPx = appearance.fontSize * appearance.lineHeight;
  const visibleLines =
    lineHeightPx > 0 ? Math.ceil(paneHeight / lineHeightPx) : 0;

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

  const changeMarks = useChangeMarks({
    documentId: meta.documentId,
    documentVersion: meta.documentVersion,
    dirty: meta.dirty,
    handleRef,
  });

  const minimapOn = useAppStore((state) => state.minimap);
  const minimapAutohide = useAppStore((state) => state.minimapAutohide);
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
          chain={context.breadcrumbs}
          onPick={context.goTo}
          loadSiblings={context.siblingsOf}
        />
      )}
      <div ref={paneRef} className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <StickyHeader chain={context.sticky} onPick={context.goTo} />
          <div
            ref={containerRef}
            className="h-full overflow-hidden"
            onContextMenu={onContextMenu}
          />
          <SearchOverviewRuler
            matches={searchPositions}
            documentLength={searchOverviewLength}
          />
        </div>
        {minimapOn && (
          <Minimap
            totalLines={meta.lineCount}
            topLine={topLine}
            visibleLines={visibleLines}
            density={density}
            matches={searchPositions}
            changes={changeMarks}
            autohide={minimapAutohide}
            onSeek={(line) => handleRef.current?.revealLineColumn(line + 1, 1)}
          />
        )}
      </div>
    </div>
  );
}
