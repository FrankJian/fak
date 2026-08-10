/**
 * 安装更新前的未保存内容保护（SPEC §12.3.3 第 4 条）。
 *
 * 更新装完立刻重启，脏文档要么先落盘要么就丢了。取消保存等于中止更新——
 * 「先更新再说，回头再存」在这里是不成立的。
 */
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";

interface ConfirmUpdateInstallDialogProps {
  open: boolean;
  dirtyCount: number;
  onSaveAndInstall: () => void;
  onCancel: () => void;
}

export function ConfirmUpdateInstallDialog({
  open,
  dirtyCount,
  onSaveAndInstall,
  onCancel,
}: ConfirmUpdateInstallDialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t("update.unsavedTitle")}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t("update.cancelInstall")}</Button>
          <Button variant="strong" onClick={onSaveAndInstall}>
            {t("update.saveAndInstall")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[var(--text-secondary)]">
        {t("update.unsaved", { count: dirtyCount })}
      </p>
    </Modal>
  );
}
