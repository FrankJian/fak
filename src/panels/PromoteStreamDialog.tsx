import { useState } from 'react';
import { Button } from '../design/components/Button';
import { Modal } from '../design/components/Modal';
import { useTranslation } from '../i18n/useTranslation';
import { formatBytes } from '../lib/format';

interface PromoteStreamDialogProps {
  open: boolean;
  sizeBytes: number;
  onConfirm: () => void;
  onClose: () => void;
}

const SECOND_CONFIRMATION_BYTES = 256 * 1024 * 1024;

/** Tier C → Tier B 前明确显示内存估算（SPEC §4.1）。 */
export function PromoteStreamDialog({
  open,
  sizeBytes,
  onConfirm,
  onClose,
}: PromoteStreamDialogProps) {
  const { t } = useTranslation();
  const [confirmedHighMemory, setConfirmedHighMemory] = useState(false);
  const estimate = sizeBytes * 3;
  const needsSecondConfirmation = estimate > SECOND_CONFIRMATION_BYTES;

  const confirm = () => {
    if (needsSecondConfirmation && !confirmedHighMemory) {
      setConfirmedHighMemory(true);
      return;
    }
    onConfirm();
  };

  return (
    <Modal
      open={open}
      title={t('stream.promoteTitle')}
      onClose={onClose}
      closeOnScrimClick={false}
      footer={
        <>
          <Button onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button variant="strong" onClick={confirm}>
            {t('stream.promoteConfirm')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[var(--text-secondary)]">
        {t('stream.promoteBody', { size: formatBytes(estimate) })}
      </p>
      {confirmedHighMemory && (
        <p className="mb-0 mt-[var(--space-3)] text-[var(--warning)]">
          {t('stream.promoteHighMemory')}
        </p>
      )}
    </Modal>
  );
}
