/**
 * 查找结果列表（SPEC F4.4：行号槽 + 命中预览，点击跳转并居中）。
 *
 * 预览与其中的高亮区间都由 Rust 算好，这里只切片显示——前端自己去原文里
 * 找一遍等于第二套查找实现，两套的边界条件迟早会分叉。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { copyToClipboard } from "../ipc/clipboard";
import type { MatchRow } from "../ipc/search";
import { rowWindow } from "../lib/virtualList";

interface FindResultListProps {
  rows: readonly MatchRow[];
  /** 当前命中的下标；-1 表示尚未定位 */
  current: number;
  total: number;
  onPick: (index: number) => void;
  onReachEnd: () => void;
}

/** 距底部多少像素就开始取下一页。留一屏的余量，滚动才不会顿住。 */
const LOAD_MORE_THRESHOLD_PX = 160;
const ROW_HEIGHT = 24;
const VIEWPORT_HEIGHT = 240;

interface ResultMenu {
  x: number;
  y: number;
}

function PreviewText({ row }: { row: MatchRow }) {
  const boundaries = new Set([
    0,
    row.preview.length,
    row.previewStart,
    row.previewEnd,
  ]);
  for (const range of row.secondaryRanges) {
    boundaries.add(Math.max(0, Math.min(row.preview.length, range.start)));
    boundaries.add(Math.max(0, Math.min(row.preview.length, range.end)));
  }
  const points = [...boundaries].sort((left, right) => left - right);

  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const primary = start >= row.previewStart && end <= row.previewEnd;
    const secondary = row.secondaryRanges.some(
      (range) => start >= range.start && end <= range.end,
    );
    const text = row.preview.slice(start, end);
    if (!primary && !secondary) return text;
    return (
      <mark
        key={`${start}-${end}`}
        className={
          primary
            ? "bg-[var(--match-other-bg)] text-[var(--text-primary)]"
            : "bg-[var(--match-refine-bg)] text-[var(--text-primary)]"
        }
      >
        {text}
      </mark>
    );
  });
}

export function FindResultList({
  rows,
  current,
  total,
  onPick,
  onReachEnd,
}: FindResultListProps) {
  const { t } = useTranslation();
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [menu, setMenu] = useState<ResultMenu | null>(null);
  const dragAnchorRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const itemCount = rows.length + Number(rows.length < total);
  const visible = useMemo(
    () => rowWindow(scrollTop, VIEWPORT_HEIGHT, ROW_HEIGHT, itemCount),
    [itemCount, scrollTop],
  );

  const select = useCallback(
    (index: number, shiftKey: boolean, toggle: boolean) => {
      if (shiftKey) {
        const anchor = selectionAnchor ?? index;
        const [start, end] = [anchor, index].sort(
          (left, right) => left - right,
        );
        setSelected((previous) => {
          const next = toggle ? new Set(previous) : new Set<number>();
          for (
            let selectedIndex = start;
            selectedIndex <= end;
            selectedIndex += 1
          ) {
            next.add(selectedIndex);
          }
          return next;
        });
        return;
      }

      setSelectionAnchor(index);
      setSelected((previous) => {
        if (!toggle) return new Set([index]);
        const next = new Set(previous);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    [selectionAnchor],
  );

  const selectDragRange = useCallback((from: number, to: number) => {
    const [start, end] = [from, to].sort((left, right) => left - right);
    setSelectionAnchor(from);
    setSelected(
      new Set(
        Array.from({ length: end - start + 1 }, (_, index) => start + index),
      ),
    );
  }, []);

  const copySelected = useCallback(() => {
    const text = [...selected]
      .sort((left, right) => left - right)
      .map((index) => {
        const row = rows[index];
        return row ? `${row.line + 1}\t${row.preview}` : "";
      })
      .filter(Boolean)
      .join("\n");
    if (text !== "") void copyToClipboard(text);
    setMenu(null);
  }, [rows, selected]);

  if (rows.length === 0) return null;

  return (
    <div
      // 结果是「跳转目标」而不是「可选值」，用 listbox 会让读屏念成表单控件
      role="list"
      aria-label={t("find.results")}
      className="max-h-[240px] min-h-0 overflow-auto border-t border-[var(--border-subtle)]"
      onPointerDown={() => setMenu(null)}
      onScroll={(event) => {
        const list = event.currentTarget;
        setScrollTop(list.scrollTop);
        const remaining =
          list.scrollHeight - list.scrollTop - list.clientHeight;
        if (remaining <= LOAD_MORE_THRESHOLD_PX) onReachEnd();
      }}
    >
      <div
        className="relative"
        style={{ height: `${itemCount * ROW_HEIGHT}px` }}
      >
        {Array.from({ length: visible.end - visible.start }, (_, offset) => {
          const index = visible.start + offset;
          const row = rows[index];
          if (!row) {
            return (
              <div
                key="more"
                className="absolute inset-x-0 flex items-center px-[var(--space-3)] text-[var(--text-tertiary)]"
                style={{
                  top: `${index * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                  fontSize: "var(--font-size-small)",
                }}
              >
                {t("find.more", { count: String(total - rows.length) })}
              </div>
            );
          }
          return (
            <button
              key={`${row.start}-${row.end}`}
              type="button"
              aria-current={index === current}
              aria-pressed={selected.has(index)}
              onClick={(event) => {
                if (!draggedRef.current) {
                  select(index, event.shiftKey, event.ctrlKey || event.metaKey);
                }
                draggedRef.current = false;
                onPick(index);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragAnchorRef.current = index;
                draggedRef.current = false;
              }}
              onPointerEnter={(event) => {
                const anchor = dragAnchorRef.current;
                if (event.buttons !== 1 || anchor === null || anchor === index)
                  return;
                draggedRef.current = true;
                selectDragRange(anchor, index);
              }}
              onPointerUp={() => {
                dragAnchorRef.current = null;
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!selected.has(index)) {
                  setSelectionAnchor(index);
                  setSelected(new Set([index]));
                }
                setMenu({ x: event.clientX, y: event.clientY });
              }}
              className={[
                "absolute inset-x-0 flex items-center gap-[var(--space-3)] px-[var(--space-3)] text-left",
                index === current || selected.has(index)
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]",
              ].join(" ")}
              style={{
                top: `${index * ROW_HEIGHT}px`,
                height: `${ROW_HEIGHT}px`,
                fontSize: "var(--font-size-small)",
              }}
            >
              {/* 行号是数字列，必须等宽对齐（SPEC §6.4） */}
              <span className="shrink-0 tabular-nums text-[var(--text-tertiary)]">
                {row.line + 1}
              </span>
              <span className="mono min-w-0 flex-1 truncate">
                <PreviewText row={row} />
              </span>
            </button>
          );
        })}
      </div>
      {menu !== null && (
        <div
          role="menu"
          className="fixed z-30 border border-[var(--border-default)] bg-[var(--bg-raised)] p-[var(--space-1)] shadow-[var(--shadow-popover)]"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="h-[var(--h-button)] px-[var(--space-3)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            onClick={copySelected}
          >
            {t("find.copyResults")}
          </button>
        </div>
      )}
    </div>
  );
}
