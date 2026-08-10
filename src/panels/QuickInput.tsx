/**
 * 命令面板 / 快速打开 / 跳转行共用的输入外壳（SPEC F14、P2-06 步骤 3）。
 *
 * 三个面板的差别只有「数据从哪来」与「回车做什么」，交互完全一致：
 * 上下键移动、回车提交、Esc 关闭、点击遮罩关闭。把这层抽出来，
 * 三处就不会各自长出略有出入的键盘行为——那种不一致用户说不清，但用着别扭。
 */
import { Icon } from "../design/Icon";
import type { IconName } from "../design/iconRegistry";

export interface QuickInputItem {
  id: string;
  label: string;
  icon?: IconName;
  matched?: readonly number[];
  /** 行尾的次要信息：快捷键、路径、行号 */
  detail?: string;
  /** 置灰而不是隐藏——藏起来用户会以为功能不存在（SPEC F14） */
  disabled?: boolean;
}

interface QuickInputProps {
  icon: IconName;
  placeholder: string;
  emptyLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  items: readonly QuickInputItem[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onCommit: (index: number) => void;
  onClose: () => void;
  /** 输入不合法时显示在列表位置，红字，不弹对话框（SPEC §4.5） */
  problem?: string;
}

export function QuickInput({
  icon,
  placeholder,
  emptyLabel,
  query,
  onQueryChange,
  items,
  highlighted,
  onHighlight,
  onCommit,
  onClose,
  problem,
}: QuickInputProps) {
  const highlight = (label: string, matched: readonly number[] = []) => {
    const positions = new Set(matched);
    return [...label].map((character, index) =>
      positions.has(index) ? (
        <mark
          key={index}
          className="bg-transparent font-semibold text-[var(--text-primary)]"
        >
          {character}
        </mark>
      ) : (
        character
      ),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 这些键在面板内自行消化，不让它们冒泡到全局派发器上去
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onHighlight(Math.min(highlighted + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHighlight(Math.max(highlighted - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(highlighted);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ backgroundColor: "var(--scrim)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex w-[min(560px,90vw)] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--bg-raised)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3">
          <span className="text-[var(--text-tertiary)]">
            <Icon name={icon} />
          </span>
          {/* 回调式 ref 比 effect 少一次渲染，面板打开时输入框就已经聚焦 */}
          <input
            ref={(node) => node?.focus()}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 bg-transparent py-2 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-ui)" }}
          />
        </div>

        <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {problem && (
            <li
              className="px-3 py-2"
              style={{
                fontSize: "var(--font-size-small)",
                color: "var(--danger)",
              }}
            >
              {problem}
            </li>
          )}
          {!problem && items.length === 0 && (
            <li
              className="px-3 py-2 text-[var(--text-tertiary)]"
              style={{ fontSize: "var(--font-size-small)" }}
            >
              {emptyLabel}
            </li>
          )}
          {!problem &&
            items.map((item, index) => (
              <li
                key={item.id}
                role="option"
                aria-selected={index === highlighted}
                aria-disabled={item.disabled ?? false}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onCommit(index)}
                className="flex cursor-default items-center justify-between gap-3 px-3"
                style={{
                  height: "var(--h-row)",
                  fontSize: "var(--font-size-small)",
                  backgroundColor:
                    index === highlighted ? "var(--bg-hover)" : undefined,
                  color: item.disabled
                    ? "var(--text-disabled)"
                    : "var(--text-primary)",
                }}
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {item.icon && <Icon name={item.icon} variant="menu" />}
                  <span className="truncate">
                    {highlight(item.label, item.matched)}
                  </span>
                </span>
                {item.detail && (
                  <span
                    className="shrink-0 text-[var(--text-tertiary)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {item.detail}
                  </span>
                )}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
