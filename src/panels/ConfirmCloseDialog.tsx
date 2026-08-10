/**
 * 关闭脏文档前的确认（SPEC F2、任务 P1-09 步骤 3）。
 *
 * 三个按钮**保留文字**（SPEC §6.6.1）：「保存」与「放弃」的后果完全相反，
 * 而且「放弃」不可逆，图标区分不了这种差别。
 */
import { Button } from '../design/components/Button';
import { Modal } from '../design/components/Modal';
import { useTranslation } from '../i18n/useTranslation';

interface ConfirmCloseDialogProps {
  /** 待关闭文档的显示名；null 表示不需要确认 */
  fileName: string | null;
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function ConfirmCloseDialog({
  fileName,
  open,
  onSave,
  onDiscard,
  onCancel,
}: ConfirmCloseDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t('dialog.confirmClose.title')}
      onClose={onCancel}
      // 点遮罩误关等于「取消」，但这里连误触的机会都不给：
      // 用户正站在一个会丢数据的岔路口上
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            {t('dialog.discard')}
          </Button>
          <Button variant="strong" onClick={onSave}>
            {t('dialog.save')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[var(--text-primary)]" style={{ fontSize: 'var(--font-size-ui)' }}>
        {t('dialog.confirmClose.body', { name: fileName || t('tab.untitled') })}
      </p>
    </Modal>
  );
}
