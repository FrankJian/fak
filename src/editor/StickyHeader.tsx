/**
 * 粘性滚动（SPEC F3.2）：视口顶部固定显示当前所在的父级结构，最多 3 层。
 *
 * 浮在编辑区上层而不是挤占它的高度：挤占的话每滚过一个函数边界，
 * 正文都要跟着上下跳一行。
 */
import { useTranslation } from '../i18n/useTranslation';
import type { OutlineNode } from '../ipc/outline';

const ROW_HEIGHT = 22;

interface StickyHeaderProps {
  chain: readonly OutlineNode[];
  onPick: (node: OutlineNode) => void;
  /** CodeMirror 行号、折叠和标记槽的总宽度；标题只能覆盖正文区域。 */
  gutterWidth: number;
  /** 0 基视口首行；仍在视口中的定义不能再画一份粘性副本。 */
  topLine: number;
}

export function StickyHeader({
  chain,
  onPick,
  gutterWidth,
  topLine,
}: StickyHeaderProps) {
  const { t } = useTranslation();
  const hiddenAboveViewport = chain.filter((node) => node.line < topLine);
  if (hiddenAboveViewport.length === 0) return null;

  return (
    <div
      aria-label={t('sticky.label')}
      // 只有行本身接管点击，空白处的滚轮与选区要照样落到编辑器上
      className="pointer-events-none absolute right-0 top-0 z-10 bg-[var(--bg-raised)]"
      style={{ left: `${gutterWidth}px` }}
    >
      {hiddenAboveViewport.map((node, depth) => (
        <button
          key={`${node.line}-${node.name}`}
          type="button"
          onClick={() => onPick(node)}
          className="pointer-events-auto flex w-full items-center truncate border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          style={{
            height: `${ROW_HEIGHT}px`,
            fontSize: 'var(--font-size-small)',
            paddingLeft: `calc(var(--space-3) + ${depth * 12}px)`,
          }}
        >
          <span className="mono truncate">{node.name}</span>
        </button>
      ))}
    </div>
  );
}
