/**
 * 双栏差异视图（SPEC F5.2）。
 *
 * **共享一条垂直滚动条**：两栏放在同一个滚动容器里，对齐就不可能失步——
 * 两个独立滚动区靠事件互相同步的做法，在惯性滚动与缩放下必然抖。
 *
 * 只渲染视口内的行。十万行 × 两栏如果全画出来是二十万个 DOM 节点，
 * 那个量级下连首次布局都要几秒。
 *
 * **本版两栏为只读**：SPEC F5.3 的「就地编辑」与「复制到对侧」尚未实现，
 * 见 tasks/PHASE-3 的标注。
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import type { DocumentMeta } from "../ipc/documents";
import { documentMeta, readAllText } from "../ipc/documents";
import { MAX_PAGE, type DiffBlock } from "../ipc/diff";
import { useTranslation } from "../i18n/useTranslation";
import { rowWindow, scrollToCenter, stepChanged } from "../lib/diffView";
import { logger } from "../lib/logger";
import type { DiffTab } from "../store/diffStore";
import { type EditorHandle } from "../editor/useEditorView";
import { DiffLine, DIFF_ROW_HEIGHT } from "./DiffLine";
import { DiffEditorColumn } from "./DiffEditorColumn";
import { DiffOverviewRuler } from "./DiffOverviewRuler";
import { DiffToolbar } from "./DiffToolbar";
import { useDiffSession } from "./useDiffSession";

/** SPEC F5.2：中间分隔条可拖拽，比例范围 20%–80%。 */
export const MIN_SPLIT = 20;
export const MAX_SPLIT = 80;

export function clampSplit(percent: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent));
}

interface DiffViewProps {
  tab: DiffTab;
  onClose: () => void;
  /** 把导航挂给外层，命令面板与快捷键才够得到（SPEC §6.6.2） */
  navigationRef?: React.RefObject<((forward: boolean) => void) | null>;
}

interface EditorData {
  meta: DocumentMeta;
  text: string;
}

interface ContextTarget {
  side: "left" | "right";
  block: DiffBlock;
  x: number;
  y: number;
}

function decorationsFor(
  blocks: readonly DiffBlock[],
  side: "left" | "right",
  rowAt: (
    row: number,
  ) => ReturnType<ReturnType<typeof useDiffSession>["rowAt"]>,
) {
  const marks: { line: number; kind: DiffBlock["kind"] }[] = [];
  const fillers: { line: number; lines: number }[] = [];
  const inline: { line: number; from: number; to: number }[] = [];
  for (const block of blocks) {
    const start = side === "left" ? block.leftStart : block.rightStart;
    const count = side === "left" ? block.leftCount : block.rightCount;
    for (let line = start; line < start + count; line += 1) {
      marks.push({ line, kind: block.kind });
    }
    const missing = block.rowCount - count;
    if (missing > 0) fillers.push({ line: start + count, lines: missing });
    for (let offset = 0; offset < block.rowCount; offset += 1) {
      const row = rowAt(block.row + offset);
      const line = side === "left" ? row?.left : row?.right;
      const spans = side === "left" ? row?.leftSpans : row?.rightSpans;
      if (line !== null && line !== undefined) {
        spans?.forEach((span) =>
          inline.push({ line, from: span.start, to: span.end }),
        );
      }
    }
  }
  return { marks, fillers, inline };
}

function blockAtLine(
  blocks: readonly DiffBlock[],
  side: "left" | "right",
  line: number,
): DiffBlock | null {
  return (
    blocks.find((block) => {
      const start = side === "left" ? block.leftStart : block.rightStart;
      const count = side === "left" ? block.leftCount : block.rightCount;
      return count > 0 && line >= start && line < start + count;
    }) ?? null
  );
}

export function DiffView({ tab, onClose, navigationRef }: DiffViewProps) {
  const { t } = useTranslation();
  const session = useDiffSession(tab);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState(50);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [leftEditor, setLeftEditor] = useState<EditorData | null>(null);
  const [rightEditor, setRightEditor] = useState<EditorData | null>(null);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [activeRow, setActiveRow] = useState(0);
  const leftHandle = useRef<EditorHandle | null>(null);
  const rightHandle = useRef<EditorHandle | null>(null);
  const syncingScroll = useRef(false);
  /** 当前停在第几个对齐行，供「上一处 / 下一处」接着走 */
  const cursorRow = useRef(0);

  const totalRows = session.started?.totalRows ?? 0;
  const view = rowWindow(scrollTop, viewportHeight, DIFF_ROW_HEIGHT, totalRows);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([documentMeta(tab.leftId), documentMeta(tab.rightId)])
      .then(async ([leftMeta, rightMeta]) => {
        const [leftText, rightText] = await Promise.all([
          readAllText(leftMeta.documentId, leftMeta.lineCount),
          readAllText(rightMeta.documentId, rightMeta.lineCount),
        ]);
        if (cancelled) return;
        setLeftEditor({ meta: leftMeta, text: leftText });
        setRightEditor({ meta: rightMeta, text: rightText });
      })
      .catch((error: unknown) =>
        logger.warn("diff editor loading failed", error),
      );
    return () => {
      cancelled = true;
    };
  }, [tab.leftId, tab.rightId]);

  useEffect(() => {
    leftHandle.current?.showDiffDecorations(
      decorationsFor(session.blocks, "left", session.rowAt),
    );
    rightHandle.current?.showDiffDecorations(
      decorationsFor(session.blocks, "right", session.rowAt),
    );
  }, [session.blocks, session.rowAt, leftEditor, rightEditor]);

  const { blocks, ensure } = session;
  useEffect(() => {
    const pages = new Set<number>();
    for (const block of blocks) {
      for (
        let row = block.row;
        row < block.row + block.rowCount;
        row += MAX_PAGE
      ) {
        pages.add(Math.floor(row / MAX_PAGE) * MAX_PAGE);
      }
    }
    pages.forEach((start) => ensure({ start, end: start + MAX_PAGE }));
  }, [blocks, ensure]);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      const left = leftHandle.current?.scrollElement();
      const right = rightHandle.current?.scrollElement();
      if (!left || !right) return;
      const link = (from: HTMLElement, to: HTMLElement) => () => {
        if (syncingScroll.current) return;
        syncingScroll.current = true;
        to.scrollTop = from.scrollTop;
        syncingScroll.current = false;
      };
      const fromLeft = link(left, right);
      const fromRight = link(right, left);
      left.addEventListener("scroll", fromLeft, { passive: true });
      right.addEventListener("scroll", fromRight, { passive: true });
      return () => {
        left.removeEventListener("scroll", fromLeft);
        right.removeEventListener("scroll", fromRight);
      };
    });
    return () => cancelAnimationFrame(timer);
  }, [leftEditor, rightEditor]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() =>
      setViewportHeight(scroller.clientHeight),
    );
    observer.observe(scroller);
    setViewportHeight(scroller.clientHeight);
    return () => observer.disconnect();
  }, []);

  // 换一份结果就回到顶部：旧的滚动位置在新对齐里指向的是另一处。
  // 只动滚动容器，`scrollTop` 由随之而来的 scroll 事件校正
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
    cursorRow.current = 0;
  }, [session.started]);

  const { start: viewStart, end: viewEnd } = view;
  useEffect(() => {
    if (viewEnd > viewStart) ensure({ start: viewStart, end: viewEnd });
  }, [ensure, viewStart, viewEnd]);

  const goToRow = (row: number) => {
    cursorRow.current = row;
    setActiveRow(row);
    const top = scrollToCenter(row, DIFF_ROW_HEIGHT, viewportHeight, totalRows);
    scrollerRef.current?.scrollTo({ top });
    leftHandle.current?.scrollElement()?.scrollTo({ top });
    rightHandle.current?.scrollElement()?.scrollTo({ top });
  };

  const openContextMenu = (
    side: "left" | "right",
    event: React.MouseEvent<HTMLElement>,
  ) => {
    const handle = side === "left" ? leftHandle.current : rightHandle.current;
    const line = handle?.lineAtCoords(event.clientX, event.clientY);
    const block =
      line === null || line === undefined
        ? null
        : blockAtLine(session.blocks, side, line);
    if (!block) return;
    event.preventDefault();
    setContextTarget({ side, block, x: event.clientX, y: event.clientY });
  };

  const copyToOther = () => {
    if (!contextTarget) return;
    const source =
      contextTarget.side === "left" ? leftHandle.current : rightHandle.current;
    const target =
      contextTarget.side === "left" ? rightHandle.current : leftHandle.current;
    const sourceStart =
      contextTarget.side === "left"
        ? contextTarget.block.leftStart
        : contextTarget.block.rightStart;
    const sourceCount =
      contextTarget.side === "left"
        ? contextTarget.block.leftCount
        : contextTarget.block.rightCount;
    const targetStart =
      contextTarget.side === "left"
        ? contextTarget.block.rightStart
        : contextTarget.block.leftStart;
    const targetCount =
      contextTarget.side === "left"
        ? contextTarget.block.rightCount
        : contextTarget.block.leftCount;
    const targetReadOnly =
      contextTarget.side === "left"
        ? rightEditor?.meta.readOnly
        : leftEditor?.meta.readOnly;
    if (!source || !target || targetReadOnly) return;
    target.replaceLineRange(
      targetStart,
      targetStart + targetCount,
      source.getLineRangeText(sourceStart, sourceStart + sourceCount),
    );
    target.focus();
    setContextTarget(null);
  };

  const step = (forward: boolean) => {
    const marks = session.started?.changed ?? [];
    const target = stepChanged(marks, cursorRow.current, forward);
    if (target !== null) goToRow(target);
  };

  useEffect(() => {
    if (!navigationRef) return;
    navigationRef.current = step;
    return () => {
      navigationRef.current = null;
    };
  });

  const dragRef = useRef<{
    startX: number;
    startSplit: number;
    width: number;
  } | null>(null);
  // 监听常挂着，靠 `dragRef` 判断当下是不是在拖。比按下时挂、抬起时摘要稳：
  // 后者每次都要摘掉「当初挂上去的那一个」函数引用，一渲染就对不上了
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.width <= 0) return;
      setSplit(
        clampSplit(
          drag.startSplit + ((event.clientX - drag.startX) / drag.width) * 100,
        ),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const rows = [];
  for (let index = view.start; index < view.end; index += 1) {
    const row = session.rowAt(index);
    rows.push(
      row ?? {
        kind: "equal" as const,
        left: null,
        right: null,
        leftSpans: [],
        rightSpans: [],
      },
    );
  }
  const useReadonlyFallback =
    !session.alignmentComplete ||
    leftEditor?.meta.mode === "stream" ||
    rightEditor?.meta.mode === "stream";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-base)]">
      <DiffToolbar
        options={session.options}
        onOptionsChange={session.setOptions}
        stats={session.started?.stats ?? null}
        changedTotal={session.started?.changedTotal ?? 0}
        loading={session.loading}
        onPrevious={() => step(false)}
        onNext={() => step(true)}
        onReload={session.reload}
        onClose={onClose}
      />

      <div
        className="flex shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-[var(--space-2)] py-[2px] text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        <span className="min-w-0 truncate" style={{ flexBasis: `${split}%` }}>
          {tab.leftName}
        </span>
        <span className="min-w-0 flex-1 truncate">{tab.rightName}</span>
      </div>

      {session.problem && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <span style={{ color: "var(--danger)" }}>
            <Icon name="error" variant="status" />
          </span>
          {session.problem}
        </div>
      )}

      {/* 粗对齐会整体关掉行内差异，这件事必须说出来：否则用户会以为
          行内差异功能坏了（SPEC §6.7 的「解释而不是沉默」） */}
      {session.started?.coarse && (
        <div
          className="shrink-0 border-b border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("diff.coarse")}
        </div>
      )}

      {useReadonlyFallback ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            ref={scrollerRef}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div
              style={{ height: `${totalRows * DIFF_ROW_HEIGHT}px` }}
              className="relative"
            >
              <div
                className="absolute inset-x-0 top-0 flex"
                style={{
                  transform: `translateY(${view.start * DIFF_ROW_HEIGHT}px)`,
                }}
              >
                <div
                  className="min-w-0 shrink-0"
                  style={{ flexBasis: `${split}%` }}
                >
                  {rows.map((row, offset) => (
                    <DiffLine
                      key={view.start + offset}
                      kind={row.kind}
                      line={row.left}
                      text={row.left === null ? "" : session.leftLine(row.left)}
                      spans={row.leftSpans}
                    />
                  ))}
                </div>

                <div
                  role="separator"
                  aria-label={t("diff.resize")}
                  aria-orientation="vertical"
                  className="w-[3px] shrink-0 cursor-col-resize bg-[var(--border-default)] hover:bg-[var(--accent-border)]"
                  onPointerDown={(event) => {
                    const width =
                      event.currentTarget.parentElement?.clientWidth ?? 0;
                    dragRef.current = {
                      startX: event.clientX,
                      startSplit: split,
                      width,
                    };
                  }}
                />

                <div className="min-w-0 flex-1">
                  {rows.map((row, offset) => (
                    <DiffLine
                      key={view.start + offset}
                      kind={row.kind}
                      line={row.right}
                      text={
                        row.right === null ? "" : session.rightLine(row.right)
                      }
                      spans={row.rightSpans}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DiffOverviewRuler
            marks={session.started?.changed ?? []}
            totalRows={totalRows}
            viewportStart={view.start}
            viewportRows={Math.max(
              1,
              Math.ceil(viewportHeight / DIFF_ROW_HEIGHT),
            )}
            onPick={goToRow}
          />
        </div>
      ) : leftEditor &&
        rightEditor &&
        leftEditor.meta.documentId === tab.leftId &&
        rightEditor.meta.documentId === tab.rightId ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div
            className="min-h-0 min-w-0 shrink-0"
            style={{ flexBasis: `${split}%` }}
          >
            <DiffEditorColumn
              meta={leftEditor.meta}
              text={leftEditor.text}
              handleRef={leftHandle}
              autoFocus
              onEdited={session.scheduleReload}
              onContextMenu={(event) => openContextMenu("left", event)}
            />
          </div>
          <div
            role="separator"
            aria-label={t("diff.resize")}
            aria-orientation="vertical"
            className="w-[3px] shrink-0 cursor-col-resize bg-[var(--border-default)] hover:bg-[var(--accent-border)]"
            onPointerDown={(event) => {
              const width = event.currentTarget.parentElement?.clientWidth ?? 0;
              dragRef.current = {
                startX: event.clientX,
                startSplit: split,
                width,
              };
            }}
          />
          <div className="min-h-0 min-w-0 flex-1">
            <DiffEditorColumn
              meta={rightEditor.meta}
              text={rightEditor.text}
              handleRef={rightHandle}
              autoFocus={false}
              onEdited={session.scheduleReload}
              onContextMenu={(event) => openContextMenu("right", event)}
            />
          </div>
          <DiffOverviewRuler
            marks={session.started?.changed ?? []}
            totalRows={totalRows}
            viewportStart={activeRow}
            viewportRows={20}
            onPick={goToRow}
          />
        </div>
      ) : (
        <div
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {session.loading ? t("diff.computing") : t("diff.loadingDocument")}
        </div>
      )}

      {contextTarget && (
        <button
          type="button"
          role="menuitem"
          className="fixed z-50 border border-[var(--border-default)] bg-[var(--bg-surface)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-primary)] shadow-[var(--shadow-popover)] hover:bg-[var(--bg-hover)]"
          style={{
            left: contextTarget.x,
            top: contextTarget.y,
            fontSize: "var(--font-size-small)",
          }}
          disabled={
            contextTarget.side === "left"
              ? rightEditor?.meta.readOnly
              : leftEditor?.meta.readOnly
          }
          onClick={copyToOther}
        >
          {contextTarget.side === "left"
            ? t("diff.copyToRight")
            : t("diff.copyToLeft")}
        </button>
      )}
    </div>
  );
}
