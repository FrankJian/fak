/**
 * 大纲侧栏（SPEC F6.2）。
 *
 * 行高固定，超过一屏就只画视口附近的几十行：节点上限是 5000，
 * 全画出来的 DOM 代价在滚动时能看见。
 *
 * 种类靠**图标**区分而不是颜色（SPEC §6.2）：灰度截图下仍要分得清函数与类。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/iconRegistry";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import type { MessageKey } from "../i18n";
import type { SymbolKind } from "../ipc/outline";
import type { VisibleRow } from "../lib/outline";
import { rowWindow } from "../lib/virtualList";

/** SPEC F6.2：侧栏宽度 160–720 px。 */
export const MIN_WIDTH = 160;
export const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 260;
/** 行高固定才能免去量 DOM，见 lib/virtualList。 */
const ROW_HEIGHT = 22;
/** 每层缩进。再大一点，160 px 宽度下深层的名字就没地方了 */
const INDENT = 12;

export function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

export const KIND_ICON: Record<SymbolKind, IconName> = {
  function: "symbolFunction",
  method: "symbolMethod",
  class: "symbolClass",
  interface: "symbolInterface",
  enum: "symbolEnum",
  constant: "symbolConstant",
  type: "symbolType",
  module: "symbolModule",
  heading: "symbolHeading",
  key: "symbolKey",
  property: "symbolProperty",
};

export const KIND_LABEL: Record<SymbolKind, MessageKey> = {
  function: "outline.kind.function",
  method: "outline.kind.method",
  class: "outline.kind.class",
  interface: "outline.kind.interface",
  enum: "outline.kind.enum",
  constant: "outline.kind.constant",
  type: "outline.kind.type",
  module: "outline.kind.module",
  heading: "outline.kind.heading",
  key: "outline.kind.key",
  property: "outline.kind.property",
};

interface OutlinePanelProps {
  rows: readonly VisibleRow[];
  /** 当前光标所在的符号在 `rows` 里的下标 */
  active: number | null;
  supported: boolean;
  empty: boolean;
  truncated: boolean;
  /** 自动刷新已停摆（大文件），要显示手动刷新按钮（SPEC F6.3） */
  manual: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onToggle: (index: number) => void;
  onPick: (index: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function OutlinePanel({
  rows,
  active,
  supported,
  empty,
  truncated,
  manual,
  query,
  onQueryChange,
  onToggle,
  onPick,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  onClose,
}: OutlinePanelProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const onDragMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampWidth(drag.startWidth + (event.clientX - drag.startX)));
  };

  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
  };

  const notice = !supported
    ? t("outline.unsupported")
    : empty
      ? t("outline.empty")
      : rows.length === 0
        ? t("outline.noMatch")
        : null;

  // 视口高度决定要画多少行，窗口缩放与侧栏拖宽都会改它
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    setViewport(node.clientHeight);
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [notice]);

  const visible = useMemo(
    () => rowWindow(scrollTop, viewport, ROW_HEIGHT, rows.length),
    [scrollTop, viewport, rows.length],
  );

  return (
    <aside
      aria-label={t("outline.panel")}
      className="flex min-h-0 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      style={{ width: `${width}px` }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)]">
          <span
            className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {t("outline.panel")}
          </span>
          {/* 头部操作全部纯图标（SPEC §6.6.1），tooltip + aria-label + 命令面板三项补偿齐备 */}
          {manual && (
            <IconButton
              icon="reload"
              label={t("outline.refresh")}
              onClick={onRefresh}
            />
          )}
          <IconButton
            icon="expandAll"
            label={t("outline.expandAll")}
            disabled={rows.length === 0}
            onClick={onExpandAll}
          />
          <IconButton
            icon="collapseAll"
            label={t("outline.collapseAll")}
            disabled={rows.length === 0}
            onClick={onCollapseAll}
          />
          <IconButton
            icon="close"
            label={t("outline.closePanel")}
            onClick={onClose}
          />
        </header>

        {supported && !empty && (
          <div className="flex shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)]">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label={t("outline.filter")}
              placeholder={t("outline.filterPlaceholder")}
              leadingIcon="filter"
            />
            {query !== "" && (
              <IconButton
                icon="filterClear"
                label={t("outline.clearFilter")}
                onClick={() => onQueryChange("")}
              />
            )}
          </div>
        )}

        {manual && supported && (
          <p
            className="shrink-0 border-b border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {t("outline.manual")}
          </p>
        )}

        {truncated && (
          <p
            className="shrink-0 border-b border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {t("outline.truncated", { count: rows.length })}
          </p>
        )}

        {notice !== null ? (
          // 空状态要说清楚为什么是空的，光放个图标等于没说（SPEC §6.7）
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-4)] text-center text-[var(--text-tertiary)]">
            <Icon name="outline" variant="empty" />
            <span style={{ fontSize: "var(--font-size-small)" }}>{notice}</span>
          </div>
        ) : (
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-auto"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {/* 撑起总高度，行按下标绝对定位——只画视口附近的那几十行 */}
            <div
              className="relative"
              style={{ height: `${rows.length * ROW_HEIGHT}px` }}
            >
              {rows.slice(visible.start, visible.end).map((row, offset) => {
                const index = visible.start + offset;
                return (
                  <OutlineRow
                    key={row.index}
                    row={row}
                    top={index * ROW_HEIGHT}
                    active={index === active}
                    kindLabel={t(KIND_LABEL[row.node.kind])}
                    toggleLabel={
                      row.collapsed
                        ? t("outline.expand")
                        : t("outline.collapse")
                    }
                    onToggle={() => onToggle(row.index)}
                    onPick={() => onPick(index)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 拖拽把手：只改宽度，不进 React 状态以外的任何地方 */}
      <div
        role="separator"
        aria-label={t("outline.resize")}
        aria-orientation="vertical"
        className="w-[3px] shrink-0 cursor-col-resize hover:bg-[var(--accent-border)]"
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: width };
          window.addEventListener("pointermove", onDragMove);
          window.addEventListener("pointerup", endDrag);
        }}
      />
    </aside>
  );
}

interface OutlineRowProps {
  row: VisibleRow;
  top: number;
  active: boolean;
  kindLabel: string;
  toggleLabel: string;
  onToggle: () => void;
  onPick: () => void;
}

/**
 * 一行。展开箭头与名字是**并列的两个按钮**而不是嵌套：
 * 按钮套按钮在 HTML 里非法，读屏会把内层整个跳过。
 */
function OutlineRow({
  row,
  top,
  active,
  kindLabel,
  toggleLabel,
  onToggle,
  onPick,
}: OutlineRowProps) {
  return (
    <div
      className={`absolute inset-x-0 flex items-center ${active ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"}`}
      style={{
        top: `${top}px`,
        height: `${ROW_HEIGHT}px`,
        paddingLeft: `${row.node.depth * INDENT}px`,
      }}
    >
      {/* 没有子节点时也占住这块，否则同层的名字会因为有没有箭头而左右错开 */}
      {row.expandable ? (
        <button
          type="button"
          aria-label={toggleLabel}
          aria-expanded={!row.collapsed}
          onClick={onToggle}
          className="flex h-full w-[16px] shrink-0 items-center justify-center text-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          <Icon
            name={row.collapsed ? "chevronRight" : "chevronDown"}
            variant="status"
          />
        </button>
      ) : (
        <span className="w-[16px] shrink-0" />
      )}
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        title={`${kindLabel} · ${row.node.name}`}
        className={`flex h-full min-w-0 flex-1 items-center gap-[var(--space-1)] pr-[var(--space-2)] text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)] ${
          active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
        }`}
        style={{ fontSize: "var(--font-size-small)" }}
      >
        <span className="shrink-0 text-[var(--text-tertiary)]">
          <Icon name={KIND_ICON[row.node.kind]} variant="menu" />
        </span>
        <span className="min-w-0 truncate">{row.node.name}</span>
      </button>
    </div>
  );
}
