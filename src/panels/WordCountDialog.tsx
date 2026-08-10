/**
 * 字数统计（SPEC F9.3）。
 *
 * 数字全部 `tabular-nums` 右对齐（SPEC §6.4）：等宽数字才能让几行数据
 * 竖着对齐，不然位数一变整列就歪。
 */
import { Modal } from '../design/components/Modal';
import { useTranslation } from '../i18n/useTranslation';
import type { MessageKey } from '../i18n';
import type { WordCount } from '../ipc/textops';

const ROWS: ReadonlyArray<{ key: keyof WordCount; labelKey: MessageKey }> = [
  { key: 'words', labelKey: 'wordCount.words' },
  { key: 'characters', labelKey: 'wordCount.characters' },
  { key: 'charactersNoSpaces', labelKey: 'wordCount.charactersNoSpaces' },
  { key: 'lines', labelKey: 'wordCount.lines' },
  { key: 'paragraphs', labelKey: 'wordCount.paragraphs' },
  { key: 'bytes', labelKey: 'wordCount.bytes' },
];

interface WordCountDialogProps {
  open: boolean;
  counts: WordCount | null;
  /** 统计的是选区而不是全文，要说出来，否则用户会以为数字错了 */
  selectionOnly: boolean;
  onClose: () => void;
}

export function WordCountDialog({ open, counts, selectionOnly, onClose }: WordCountDialogProps) {
  const { t, language } = useTranslation();
  const format = new Intl.NumberFormat(language);

  return (
    <Modal open={open} title={t('wordCount.title')} onClose={onClose} widthPx={360}>
      {selectionOnly && (
        <p
          className="mb-[var(--space-2)] text-[var(--text-tertiary)]"
          style={{ fontSize: 'var(--font-size-small)' }}
        >
          {t('wordCount.selectionOnly')}
        </p>
      )}
      <dl className="m-0 flex flex-col gap-[var(--space-1)]">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-[var(--space-4)]">
            <dt className="text-[var(--text-secondary)]">{t(row.labelKey)}</dt>
            <dd className="m-0 tabular-nums text-[var(--text-primary)]">
              {counts === null ? '—' : format.format(counts[row.key])}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
