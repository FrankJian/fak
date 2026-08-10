/**
 * 标签栏（SPEC F2.1、F5.1）。脏标记用一个圆点而不是星号：
 * 星号会让文件名宽度跳变，圆点占位固定。
 *
 * 对比标签排在文档标签之后（SPEC F5.1 第 3 条）。它不是文档：没有脏标记，
 * 也不参与 Ctrl+Tab 的 MRU——那份顺序属于「上次编辑的是哪个文件」。
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import type { Tab } from "../store/documentStore";
import type { DiffTab } from "../store/diffStore";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
  onQuickClose: (documentId: string) => void;
  onToggleLock: (documentId: string) => void;
  onCloseOthers: (documentId: string) => void;
  onCloseToRight: (documentId: string) => void;
  onCopyPath: (documentId: string) => void;
  onRevealInFileManager: (documentId: string) => void;
  /** 右键「设为对比源」/「与对比源比较」（SPEC F5.1） */
  onSetCompareSource: (documentId: string) => void;
  onCompareWithSource: (documentId: string) => void;
  compareSourceId: string | null;
  diffTabs: readonly DiffTab[];
  activeDiffId: string | null;
  onActivateDiff: (id: string) => void;
  onCloseDiff: (id: string) => void;
}

const TAB_CLASS =
  "group flex min-w-0 cursor-default items-center gap-1.5 border-r border-[var(--border-subtle)] pl-3 pr-1.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]";

function toneOf(active: boolean): string {
  return active
    ? "bg-[var(--bg-base)] text-[var(--text-primary)]"
    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]";
}

export function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onQuickClose,
  onToggleLock,
  onCloseOthers,
  onCloseToRight,
  onCopyPath,
  onRevealInFileManager,
  onSetCompareSource,
  onCompareWithSource,
  compareSourceId,
  diffTabs,
  activeDiffId,
  onActivateDiff,
  onCloseDiff,
}: TabBarProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [menu, setMenu] = useState<{
    documentId: string;
    x: number;
    y: number;
  } | null>(null);

  const updateScrollButtons = () => {
    const element = tabsRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 0);
    setCanScrollRight(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    );
  };

  useEffect(() => {
    updateScrollButtons();
    const element = tabsRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs, diffTabs]);

  useEffect(() => {
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, []);

  if (tabs.length === 0 && diffTabs.length === 0) return null;

  return (
    <div className="flex shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      {canScrollLeft && (
        <IconButton
          icon="chevronLeft"
          label={t("tab.scrollLeft")}
          onClick={() =>
            tabsRef.current?.scrollBy({ left: -240, behavior: "smooth" })
          }
        />
      )}
      <div
        ref={tabsRef}
        role="tablist"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        style={{ height: "var(--h-tabbar, 30px)" }}
        onScroll={updateScrollButtons}
      >
        {tabs.map((tab) => {
          const { documentId, fileName, dirty } = tab.meta;
          const active = documentId === activeId && activeDiffId === null;
          const isSource = documentId === compareSourceId;
          return (
            <div
              key={documentId}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={
                isSource
                  ? t("diff.sourceHint", {
                      name: fileName || t("tab.untitled"),
                    })
                  : undefined
              }
              onClick={() => onActivate(documentId)}
              onAuxClick={(event) => {
                // 中键关闭（SPEC F2.1）。走的是与关闭图标同一个入口，
                // 所以脏文档同样会先弹确认，不会被「顺手一按」丢掉
                if (event.button !== 1) return;
                event.preventDefault();
                if (!tab.locked) onQuickClose(documentId);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({ documentId, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onActivate(documentId);
              }}
              className={[TAB_CLASS, toneOf(active)].join(" ")}
              style={{ fontSize: "var(--font-size-small)" }}
            >
              {/* 对比源用一个图标标出来，否则「设为对比源」之后界面上没有任何反馈 */}
              {isSource && (
                <span className="shrink-0 text-[var(--accent)]">
                  <Icon name="diff" variant="status" />
                </span>
              )}

              {tab.locked && (
                <span
                  className="shrink-0 text-[var(--text-tertiary)]"
                  title={t("tab.locked")}
                >
                  <Icon name="lock" variant="status" />
                </span>
              )}

              <span className="truncate" style={{ maxWidth: "160px" }}>
                {fileName || t("tab.untitled")}
              </span>

              {/* 圆点位置固定占位，避免脏与不脏时标签宽度跳动 */}
              <span
                aria-hidden={!dirty}
                title={dirty ? t("tab.unsaved") : undefined}
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: dirty
                    ? "var(--text-secondary)"
                    : "transparent",
                }}
              />

              <button
                type="button"
                aria-label={t("tab.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(documentId);
                }}
                className="inline-flex size-[var(--h-icon-button)] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              >
                <Icon name="close" variant="status" />
              </button>
            </div>
          );
        })}

        {diffTabs.map((tab) => {
          const active = tab.id === activeDiffId;
          const title = t("diff.tabTitle", {
            left: tab.leftName,
            right: tab.rightName,
          });
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={title}
              onClick={() => onActivateDiff(tab.id)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onCloseDiff(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onActivateDiff(tab.id);
              }}
              className={[TAB_CLASS, toneOf(active)].join(" ")}
              style={{ fontSize: "var(--font-size-small)" }}
            >
              <span className="shrink-0 text-[var(--text-tertiary)]">
                <Icon name="diff" variant="status" />
              </span>
              <span className="truncate" style={{ maxWidth: "200px" }}>
                {title}
              </span>
              <button
                type="button"
                aria-label={t("diff.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseDiff(tab.id);
                }}
                className="inline-flex size-[var(--h-icon-button)] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              >
                <Icon name="close" variant="status" />
              </button>
            </div>
          );
        })}
      </div>
      {canScrollRight && (
        <IconButton
          icon="chevronRight"
          label={t("tab.scrollRight")}
          onClick={() =>
            tabsRef.current?.scrollBy({ left: 240, behavior: "smooth" })
          }
        />
      )}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-44 border border-[var(--border-default)] bg-[var(--bg-surface)] py-[var(--space-1)] shadow-[var(--shadow-popover)]"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMenu(null)}
        >
          <TabMenuItem
            onSelect={() => onToggleLock(menu.documentId)}
            label={
              tabs.find((tab) => tab.meta.documentId === menu.documentId)
                ?.locked
                ? t("tab.unlock")
                : t("tab.lock")
            }
          />
          <div className="my-[var(--space-1)] border-t border-[var(--border-subtle)]" />
          <TabMenuItem
            onSelect={() => onCloseOthers(menu.documentId)}
            label={t("tab.closeOthers")}
          />
          <TabMenuItem
            onSelect={() => onCloseToRight(menu.documentId)}
            label={t("tab.closeToRight")}
          />
          <TabMenuItem
            onSelect={() => onCopyPath(menu.documentId)}
            label={t("tab.copyPath")}
          />
          <TabMenuItem
            onSelect={() => onRevealInFileManager(menu.documentId)}
            label={t("tab.revealInFileManager")}
          />
          <div className="my-[var(--space-1)] border-t border-[var(--border-subtle)]" />
          <TabMenuItem
            onSelect={() => onSetCompareSource(menu.documentId)}
            label={t("diff.setSource")}
          />
          <TabMenuItem
            disabled={
              compareSourceId === null || compareSourceId === menu.documentId
            }
            onSelect={() => onCompareWithSource(menu.documentId)}
            label={t("diff.compareWithSource")}
          />
        </div>
      )}
    </div>
  );
}

function TabMenuItem({
  label,
  onSelect,
  disabled = false,
}: {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full px-[var(--space-3)] py-[var(--space-1)] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-disabled)]"
      style={{ fontSize: "var(--font-size-small)" }}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
