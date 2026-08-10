/**
 * 书签侧栏（SPEC F7）。
 *
 * 按行号升序（顺序由 Rust 保证），每条显示 `行号 + 该行文本预览`，
 * 点击跳转，✕ 移除。宽度可拖拽 160–520 px。
 */
import { useRef, useState } from 'react';
import { Icon } from '../design/Icon';
import { IconButton } from '../design/components/IconButton';
import { useTranslation } from '../i18n/useTranslation';
import type { Bookmark } from '../ipc/bookmarks';

/** SPEC F7：侧栏宽度 160–520 px。 */
export const MIN_WIDTH = 160;
export const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 240;

export function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

interface BookmarkPanelProps {
  bookmarks: readonly Bookmark[];
  onPick: (line: number) => void;
  onRemove: (line: number) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function BookmarkPanel({
  bookmarks,
  onPick,
  onRemove,
  onClearAll,
  onClose,
}: BookmarkPanelProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampWidth(drag.startWidth + (event.clientX - drag.startX)));
  };

  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
  };

  return (
    <aside
      aria-label={t('bookmark.panel')}
      className="flex min-h-0 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      style={{ width: `${width}px` }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)]">
          <span
            className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
            style={{ fontSize: 'var(--font-size-small)' }}
          >
            {t('bookmark.panel')}
          </span>
          {/* 头部操作全部纯图标（SPEC §6.6.1），tooltip + aria-label + 命令面板三项补偿齐备 */}
          <IconButton
            icon="delete"
            label={t('bookmark.clearAll')}
            disabled={bookmarks.length === 0}
            onClick={onClearAll}
          />
          <IconButton icon="close" label={t('bookmark.closePanel')} onClick={onClose} />
        </header>

        {bookmarks.length === 0 ? (
          // 空状态要有文字说明为什么是空的，光放个图标等于没说（SPEC §6.7）
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-4)] text-center text-[var(--text-tertiary)]">
            <Icon name="bookmark" variant="empty" />
            <span style={{ fontSize: 'var(--font-size-small)' }}>{t('bookmark.empty')}</span>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.line} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => onPick(bookmark.line)}
                  className="flex min-w-0 flex-1 items-baseline gap-[var(--space-3)] px-[var(--space-3)] py-[2px] text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
                  style={{ fontSize: 'var(--font-size-small)' }}
                >
                  {/* 行号是数字列，必须等宽对齐（SPEC §6.4） */}
                  <span className="shrink-0 tabular-nums text-[var(--text-tertiary)]">
                    {bookmark.line + 1}
                  </span>
                  <span className="mono min-w-0 flex-1 truncate">{bookmark.preview}</span>
                </button>
                {/* hover 才显现，静止时列表保持干净（SPEC §6.6.1 行内操作） */}
                <span className="shrink-0 opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100">
                  <IconButton
                    icon="close"
                    label={t('bookmark.remove')}
                    onClick={() => onRemove(bookmark.line)}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 拖拽把手：只改宽度，不进 React 状态以外的任何地方 */}
      <div
        role="separator"
        aria-label={t('bookmark.resize')}
        aria-orientation="vertical"
        className="w-[3px] shrink-0 cursor-col-resize hover:bg-[var(--accent-border)]"
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: width };
          window.addEventListener('pointermove', onDragMove);
          window.addEventListener('pointerup', endDrag);
        }}
      />
    </aside>
  );
}
