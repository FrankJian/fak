/**
 * 对比视图里的一行（SPEC F5.2 着色、F5.4 行内片段）。
 *
 * 三层信息，缺一不可：
 *   1. **整行底色**说「这一行变了」；
 *   2. **行内更实的底色**说「变在这几个字符」（F5.4 的两级层次）；
 *   3. **行号槽里的 `+` / `-` / `~`** 让灰度截图与色盲用户也分得出类型
 *      （SPEC §6.2 禁止色觉单通道）。
 */
import type { InlineSpan, RowKind } from '../ipc/diff';
import { inlineSegments } from '../lib/diffView';

/** 固定行高。虚拟滚动靠它把滚动位置直接换算成行号，不必量 DOM。 */
export const DIFF_ROW_HEIGHT = 20;

/** 行号槽宽度，够放六位数行号 */
const GUTTER_WIDTH = 52;

const ROW_BACKGROUND: Record<RowKind, string | undefined> = {
  equal: undefined,
  insert: 'var(--diff-insert-bg)',
  delete: 'var(--diff-delete-bg)',
  modify: 'var(--diff-modify-bg)',
};

const SIGN: Record<RowKind, string> = {
  equal: '',
  insert: '+',
  delete: '-',
  modify: '~',
};

interface DiffLineProps {
  kind: RowKind;
  /** 0 基行号；`null` 表示这一侧是对齐占位，不画行号也不画正文 */
  line: number | null;
  text: string | undefined;
  spans: readonly InlineSpan[];
}

export function DiffLine({ kind, line, text, spans }: DiffLineProps) {
  const placeholder = line === null;
  const background = placeholder ? 'var(--bg-surface)' : ROW_BACKGROUND[kind];

  return (
    <div
      className="flex items-center"
      style={{ height: `${DIFF_ROW_HEIGHT}px`, backgroundColor: background }}
    >
      <span
        className="shrink-0 select-none pr-[var(--space-2)] text-right tabular-nums text-[var(--text-tertiary)]"
        style={{ width: `${GUTTER_WIDTH}px`, fontSize: 'var(--font-size-small)' }}
      >
        {placeholder ? '' : line + 1}
      </span>
      {/* 符号列固定占位，行号与正文的横向位置不随差异类型跳动 */}
      <span
        aria-hidden
        className="w-[12px] shrink-0 select-none text-center text-[var(--text-secondary)]"
        style={{ fontSize: 'var(--font-size-small)' }}
      >
        {placeholder ? '' : SIGN[kind]}
      </span>

      <span
        className="mono min-w-0 flex-1 overflow-hidden whitespace-pre"
        style={{ fontSize: 'var(--font-size-editor)', lineHeight: `${DIFF_ROW_HEIGHT}px` }}
      >
        {/* 正文还没取回来时留空而不是画骨架：一行 20 px 的骨架块在滚动时
            比空白更晃眼，而这段空白通常只存在一帧 */}
        {text === undefined
          ? ''
          : inlineSegments(text, spans).map((segment, index) => (
              <span
                // 段是按偏移切出来的，同一行内下标即稳定标识
                key={`${index}-${segment.text.length}`}
                style={
                  segment.changed
                    ? { backgroundColor: 'var(--diff-inline-bg)', borderRadius: '2px' }
                    : undefined
                }
              >
                {segment.text}
              </span>
            ))}
      </span>
    </div>
  );
}
