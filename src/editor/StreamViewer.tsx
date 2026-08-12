/**
 * Tier C 的定高虚拟列表：只向 Rust 请求可视区附近的行（SPEC §4.1）。
 *
 * 跟随模式（SPEC F16）与「跳到行 / 百分比」都挂在这里：它们要动的是同一个
 * 滚动容器，拆到别处就得把 ref 传来传去。
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { DocumentMeta } from "../ipc/documents";
import { readLines } from "../ipc/documents";
import { useTranslation } from "../i18n/useTranslation";
import { parseStreamTarget } from "../lib/streamTarget";
import { scrollMetrics, scrollTopForProgress } from "../lib/minimap";
import { StreamToolbar } from "./StreamToolbar";
import { StreamFindBar } from "./StreamFindBar";
import { useStreamFind } from "./useStreamFind";
import { Minimap } from "./Minimap";
import { useAppStore } from "../store/appStore";
import { BOTTOM_SLACK_PX, useTailFollow } from "./useTailFollow";
import { StreamReplaceDialog } from "../panels/StreamReplaceDialog";

const LINE_HEIGHT = 20;
const OVERSCAN = 120;
const CACHE_LIMIT = 2_000;

export interface StreamViewerHandle {
  revealLine: (line: number) => void;
  openFind: () => void;
  openReplace: () => void;
}

export function StreamViewer({
  meta,
  onPromote,
  handleRef,
}: {
  meta: DocumentMeta;
  onPromote: () => void;
  handleRef?: RefObject<StreamViewerHandle | null>;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(new Set<number>());
  const [cache, setCache] = useState(() => new Map<number, string>());
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [minimapScroll, setMinimapScroll] = useState({
    progress: 0,
    viewportFraction: 1,
  });
  const [gotoValue, setGotoValue] = useState("");
  // 能力说明每打开一份 Tier C 文件显示一次（SPEC P4）
  const [showCapabilities, setShowCapabilities] = useState(true);

  const scrollToEnd = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);

  const isAtBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return true;
    return (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      BOTTOM_SLACK_PX
    );
  }, []);

  const follow = useTailFollow({
    documentId: meta.documentId,
    initialLineCount: meta.lineCount,
    scrollToEnd,
    isAtBottom,
  });
  const lineCount = follow.lineCount;

  const fetchWindow = useCallback(
    async (start: number, count: number) => {
      if (count <= 0) return;
      const pending = pendingRef.current;
      if (
        [...Array(count).keys()].every((offset) => pending.has(start + offset))
      )
        return;
      for (let line = start; line < start + count; line += 1) pending.add(line);
      try {
        const window = await readLines(meta.documentId, start, count);
        setCache((previous) => {
          const next = new Map(previous);
          window.lines.forEach((line, index) =>
            next.set(window.start + index, line),
          );
          if (next.size > CACHE_LIMIT) {
            [...next.keys()]
              .sort(
                (left, right) =>
                  Math.abs(right - start) - Math.abs(left - start),
              )
              .slice(0, next.size - CACHE_LIMIT)
              .forEach((line) => next.delete(line));
          }
          return next;
        });
      } finally {
        for (let line = start; line < start + count; line += 1)
          pending.delete(line);
      }
    },
    [meta.documentId],
  );

  const updateRange = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const start = Math.floor(viewport.scrollTop / LINE_HEIGHT);
    const visible = Math.ceil(viewport.clientHeight / LINE_HEIGHT);
    const end = Math.min(lineCount, start + visible);
    setRange((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
    const nextScroll = scrollMetrics(
      viewport.scrollTop,
      viewport.scrollHeight,
      viewport.clientHeight,
    );
    setMinimapScroll((previous) =>
      previous.progress === nextScroll.progress &&
      previous.viewportFraction === nextScroll.viewportFraction
        ? previous
        : nextScroll,
    );
    const fetchStart = Math.max(0, start - OVERSCAN);
    const fetchEnd = Math.min(lineCount, end + OVERSCAN);
    void fetchWindow(fetchStart, fetchEnd - fetchStart);
  }, [fetchWindow, lineCount]);

  useEffect(() => {
    void fetchWindow(0, Math.min(lineCount, 40 + OVERSCAN));
  }, [fetchWindow, meta.documentId, lineCount]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(updateRange);
    observer.observe(viewport);
    const content = viewport.firstElementChild;
    if (content instanceof HTMLElement) observer.observe(content);
    updateRange();
    return () => observer.disconnect();
  }, [updateRange]);

  // 追加进来的新行要能立刻取到正文，否则跟随时末尾是一片空行
  useEffect(() => {
    if (!follow.following || follow.paused) return;
    updateRange();
  }, [follow.following, follow.paused, lineCount, updateRange]);

  const goto = useCallback(() => {
    const target = parseStreamTarget(gotoValue, lineCount);
    if (target === null) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = target * LINE_HEIGHT;
    setGotoValue("");
  }, [gotoValue, lineCount]);

  // 命中行滚到视口中部而不是顶部：贴着顶边看不到上下文
  const revealLine = useCallback((line: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = Math.max(
      0,
      line * LINE_HEIGHT - viewport.clientHeight / 2,
    );
  }, []);

  const find = useStreamFind({
    documentId: meta.documentId,
    onReveal: revealLine,
  });
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const currentMatch = find.current >= 0 ? find.matches[find.current] : null;
  const minimapOn = useAppStore((state) => state.minimap);
  const minimapAutohide = useAppStore((state) => state.minimapAutohide);

  useImperativeHandle(
    handleRef,
    () => ({
      revealLine,
      openFind: () => setFindOpen(true),
      openReplace: () => setReplaceOpen(true),
    }),
    [revealLine],
  );

  const rows = [];
  for (let line = range.start; line < range.end; line += 1) {
    rows.push(
      <div
        key={line}
        className="flex whitespace-pre"
        style={{ height: LINE_HEIGHT }}
      >
        <span className="mono w-16 shrink-0 pr-[var(--space-3)] text-right tabular-nums text-[var(--text-tertiary)]">
          {line + 1}
        </span>
        <span
          className={`mono min-w-0 truncate ${
            currentMatch?.line === line
              ? "bg-[var(--match-current-bg)] text-[var(--text-primary)]"
              : "text-[var(--text-primary)]"
          }`}
        >
          {cache.get(line) ?? "\u00a0"}
        </span>
      </div>,
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-inset)]">
      <StreamToolbar
        following={follow.following}
        paused={follow.paused}
        pendingLines={follow.pendingLines}
        truncated={follow.truncated}
        lineCount={lineCount}
        gotoValue={gotoValue}
        onGotoChange={setGotoValue}
        onGoto={goto}
        onToggleFollow={() => follow.setEnabled(!follow.following)}
        onResume={follow.resume}
        onPromote={onPromote}
        showCapabilities={showCapabilities}
        onDismissCapabilities={() => setShowCapabilities(false)}
      />
      {findOpen && (
        <StreamFindBar
          find={{
            ...find,
            close: () => {
              find.close();
              setFindOpen(false);
            },
          }}
          onReplaceToCopy={() => setReplaceOpen(true)}
        />
      )}
      {replaceOpen && (
        <StreamReplaceDialog
          documentId={meta.documentId}
          initialQuery={find.query}
          initialOptions={find.options}
          onClose={() => setReplaceOpen(false)}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className={
            minimapOn
              ? "min-h-0 min-w-0 flex-1 overflow-auto pr-[var(--w-minimap)]"
              : "min-h-0 min-w-0 flex-1 overflow-auto"
          }
          aria-label={t("stream.content")}
          onScroll={() => {
            updateRange();
            follow.noteScroll();
          }}
        >
          <div
            style={{ height: lineCount * LINE_HEIGHT, position: "relative" }}
          >
            <div
              style={{
                transform: `translateY(${range.start * LINE_HEIGHT}px)`,
              }}
            >
              {rows}
            </div>
          </div>
        </div>
        {minimapOn && (
          // Tier C 不渲染文本，只画命中标记（SPEC §4.1 能力表）
          <Minimap
            totalLines={lineCount}
            scrollProgress={minimapScroll.progress}
            viewportFraction={minimapScroll.viewportFraction}
            density={[]}
            matches={find.matches}
            changes={[]}
            autohide={minimapAutohide}
            onScrollProgress={(progress) => {
              const viewport = viewportRef.current;
              if (!viewport) return;
              viewport.scrollTop = scrollTopForProgress(
                progress,
                viewport.scrollHeight,
                viewport.clientHeight,
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
