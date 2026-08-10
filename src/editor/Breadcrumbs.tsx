/**
 * 面包屑（SPEC F3.2）：编辑区顶部一行，`文件 › 父级 › 当前符号`。
 *
 * 窄窗口下省略的是**中间层**而不是尾部：尾部那一节是「我现在在哪」，
 * 恰恰是这行字最有用的部分（SPEC F3.2 验收第 2 条）。
 *
 * 点某一节**先列出它的同级符号**再跳，而不是直接跳过去：面包屑真正的用处
 * 是「在同一层里换一个」，直接跳只是把光标送回它已经在的地方。
 */
import { useRef, useState } from "react";
import { Icon } from "../design/Icon";
import { Popover } from "../design/components/Popover";
import { useTranslation } from "../i18n/useTranslation";
import type { OutlineNode } from "../ipc/outline";
import { logger } from "../lib/logger";
import { KIND_ICON } from "../panels/OutlinePanel";

/** SPEC F3.2：面包屑一行 22 px。 */
const HEIGHT = 22;
/** 超过这么多级就把中间折成省略号 */
const MAX_VISIBLE = 4;
const MENU_WIDTH = 260;

interface BreadcrumbsProps {
  fileName: string;
  chain: readonly OutlineNode[];
  onPick: (node: OutlineNode) => void;
  /** 同级符号列表（SPEC F3.2）。取不到时退回直接跳转 */
  loadSiblings: (node: OutlineNode) => Promise<OutlineNode[]>;
}

interface Menu {
  target: OutlineNode;
  items: readonly OutlineNode[];
}

export function Breadcrumbs({
  fileName,
  chain,
  onPick,
  loadSiblings,
}: BreadcrumbsProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<Menu | null>(null);
  // 浮层锚在「刚点的那一节」上，所以锚点是一个可写的 ref，而不是某个固定节点
  const anchorRef = useRef<HTMLElement | null>(null);

  const elided = chain.length > MAX_VISIBLE;
  // 留头留尾：头一节交代最外层，尾一节是当前所在
  const shown = elided
    ? [chain[0], ...chain.slice(chain.length - (MAX_VISIBLE - 1))]
    : chain;

  const openMenu = (node: OutlineNode, anchor: HTMLElement) => {
    anchorRef.current = anchor;
    loadSiblings(node)
      .then((items) =>
        setMenu({ target: node, items: items.length > 0 ? items : [node] }),
      )
      .catch((error: unknown) => {
        // 列不出同级就退回直接跳转：点这一节的意图本来就包含「去那里」
        logger.warn("breadcrumb siblings failed", error);
        onPick(node);
      });
  };

  return (
    <nav
      aria-label={t("breadcrumb.label")}
      className="flex shrink-0 items-center gap-[var(--space-1)] overflow-hidden border-b border-[var(--border-subtle)] px-[var(--space-2)] text-[var(--text-tertiary)]"
      style={{ height: `${HEIGHT}px`, fontSize: "var(--font-size-small)" }}
    >
      <span className="shrink-0 truncate">{fileName}</span>
      {shown.map((node, index) => (
        <span
          key={`${node.start}-${node.name}`}
          className="flex min-w-0 items-center"
        >
          <Icon name="chevronRight" variant="status" />
          {elided && index === 1 && (
            <>
              <span className="shrink-0 px-[2px]">…</span>
              <Icon name="chevronRight" variant="status" />
            </>
          )}
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu !== null && menu.target.start === node.start}
            onClick={(event) => openMenu(node, event.currentTarget)}
            className="min-w-0 truncate px-[2px] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          >
            {node.name}
          </button>
        </span>
      ))}

      <Popover
        open={menu !== null}
        anchorRef={anchorRef}
        ariaLabel={t("breadcrumb.siblings")}
        onClose={() => setMenu(null)}
        align="below"
        widthPx={MENU_WIDTH}
      >
        <div
          role="menu"
          aria-label={t("breadcrumb.siblings")}
          className="py-[var(--space-1)]"
        >
          {menu?.items.map((item) => (
            <button
              key={`${item.start}-${item.name}`}
              type="button"
              role="menuitem"
              aria-current={item.start === menu.target.start || undefined}
              onClick={() => {
                setMenu(null);
                onPick(item);
              }}
              className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              style={{ fontSize: "var(--font-size-small)" }}
            >
              <Icon name={KIND_ICON[item.kind]} variant="menu" />
              <span className="min-w-0 truncate">{item.name}</span>
            </button>
          ))}
        </div>
      </Popover>
    </nav>
  );
}
