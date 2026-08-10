/**
 * 差异概览标尺（SPEC F5.2）。
 *
 * 窄条上按比例落全篇的差异标记，点击跳转。它是「这份文件差在哪几段」
 * 唯一的全局视图——滚动条只告诉你在哪，标尺告诉你该去哪。
 *
 * 三种差异用三种颜色，并且**各自靠不同的边**：颜色相近或用户是色盲时，
 * 位置仍然分得开（SPEC §6.2 禁止色觉单通道）。
 */
import { useTranslation } from '../i18n/useTranslation';
import type { ChangedMark } from '../ipc/diff';
import { rowAtFraction, rulerFraction } from '../lib/diffView';

/** 标尺宽度。太窄点不中，太宽会和分隔条抢视觉重量 */
const WIDTH_PX = 12;

const STYLE: Record<ChangedMark['kind'], { color: string; left: string; width: string }> = {
  insert: { color: 'var(--diff-insert-gutter)', left: '58%', width: '42%' },
  delete: { color: 'var(--diff-delete-gutter)', left: '0%', width: '42%' },
  modify: { color: 'var(--diff-modify-gutter)', left: '29%', width: '42%' },
};

interface DiffOverviewRulerProps {
  marks: readonly ChangedMark[];
  totalRows: number;
  /** 当前视口首行，用于画一个视口指示框 */
  viewportStart: number;
  viewportRows: number;
  onPick: (row: number) => void;
}

export function DiffOverviewRuler({
  marks,
  totalRows,
  viewportStart,
  viewportRows,
  onPick,
}: DiffOverviewRulerProps) {
  const { t } = useTranslation();

  const pickAt = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.height <= 0) return;
    onPick(rowAtFraction((event.clientY - box.top) / box.height, totalRows));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('diff.overview')}
      aria-valuemin={1}
      aria-valuemax={Math.max(1, totalRows)}
      aria-valuenow={Math.min(totalRows, viewportStart + 1)}
      onClick={pickAt}
      onKeyDown={(event) => {
        if (event.key === 'Home') onPick(0);
        if (event.key === 'End') onPick(Math.max(0, totalRows - 1));
      }}
      className="relative shrink-0 cursor-pointer border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
      style={{ width: `${WIDTH_PX}px` }}
    >
      {marks.map((mark) => {
        const style = STYLE[mark.kind];
        return (
          <span
            key={mark.row}
            aria-hidden
            className="absolute"
            style={{
              top: `${rulerFraction(mark.row, totalRows) * 100}%`,
              left: style.left,
              width: style.width,
              // 至少 2 px 才看得见；差异密集时相邻标记会连成一段，那正是想要的效果
              height: '2px',
              backgroundColor: style.color,
            }}
          />
        );
      })}

      {/* 视口指示框：只描边不填色，免得把它盖住的标记挡掉 */}
      {totalRows > 0 && (
        <span
          aria-hidden
          className="absolute left-0 w-full border border-[var(--border-strong)]"
          style={{
            top: `${rulerFraction(viewportStart, totalRows) * 100}%`,
            height: `${Math.max(2, (viewportRows / Math.max(1, totalRows)) * 100)}%`,
          }}
        />
      )}
    </div>
  );
}
