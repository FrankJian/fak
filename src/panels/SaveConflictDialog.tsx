import { Button } from '../design/components/Button';
import { Modal } from '../design/components/Modal';
import { useTranslation } from '../i18n/useTranslation';

interface SaveConflictDialogProps {
  open: boolean;
  fileName: string | null;
  onOverwrite: () => void;
  onReload: () => void;
  onCompare: () => void;
  onCancel: () => void;
}

/** 保存前发现磁盘版本已变更时的三分支（SPEC F1.5）。 */
export function SaveConflictDialog({
  open,
  fileName,
  onOverwrite,
  onReload,
  onCompare,
  onCancel,
}: SaveConflictDialogProps) {
  const { t } = useTranslation();
  const name = fileName || t('tab.untitled');

  return (
    <Modal
      open={open}
      title={t('dialog.saveConflict.title')}
      onClose={onCancel}
      closeOnScrimClick={false}
      footer={
        <>
          <Button onClick={onCancel}>{t('dialog.cancel')}</Button>
          <Button onClick={onCompare}>{t('dialog.saveConflict.compare')}</Button>
          <Button variant="danger" onClick={onReload}>
            {t('dialog.saveConflict.reload')}
          </Button>
          <Button variant="strong" onClick={onOverwrite}>
            {t('dialog.saveConflict.overwrite')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[var(--text-secondary)]">
        {t('dialog.saveConflict.body', { name })}
      </p>
    </Modal>
  );
}
