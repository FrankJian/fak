/**
 * 大批量「替换全部」的二次确认（SPEC F4.6、任务 P2-04 步骤 4）。
 *
 * 按钮**保留文字**（SPEC §6.6.1）：这是一个后果与规模都写在文案里的决定，
 * 图标表达不了「将改动 3,481 处」。
 */
import { Button } from '../design/components/Button';
import { Modal } from '../design/components/Modal';
import { useTranslation } from '../i18n/useTranslation';
import { CONFIRM_REPLACE_THRESHOLD } from './useFindReplace';

interface ConfirmReplaceAllDialogProps {
  /** 待确认的影响计数；null 表示无需确认 */
  count: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmReplaceAllDialog({
  count,
  onConfirm,
  onCancel,
}: ConfirmReplaceAllDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={count !== null}
      title={t('find.confirmReplaceAll.title')}
      onClose={onCancel}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="strong" onClick={onConfirm}>
            {t('find.replaceAll')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[var(--text-primary)]" style={{ fontSize: 'var(--font-size-ui)' }}>
        {t('find.confirmReplaceAll.body', {
          count: (count ?? 0).toLocaleString(),
          threshold: CONFIRM_REPLACE_THRESHOLD.toLocaleString(),
        })}
      </p>
    </Modal>
  );
}
