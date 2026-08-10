/**
 * 外部工具首次执行的确认（SPEC F15 步骤 5）。
 *
 * **完整命令必须原样展示**：用户要确认的是「即将在我机器上跑什么」，
 * 摘要或工具名都不足以让他判断。「不再询问」写进 `externalToolsConfirmed`。
 */
import { useState } from "react";
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { Switch } from "../design/components/Switch";
import { useTranslation } from "../i18n/useTranslation";
import type { PendingConfirmation } from "./useExternalTools";

interface ConfirmExternalToolDialogProps {
  pending: PendingConfirmation | null;
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
}

export function ConfirmExternalToolDialog({
  pending,
  onConfirm,
  onCancel,
}: ConfirmExternalToolDialogProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);

  return (
    <Modal
      open={pending !== null}
      title={t("externalTool.confirmTitle")}
      onClose={onCancel}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t("dialog.cancel")}
          </Button>
          <Button variant="strong" onClick={() => onConfirm(remember)}>
            {t("externalTool.confirmRun")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-3)]">
        <p
          className="m-0 text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-ui)" }}
        >
          {t("externalTool.confirmBody", { name: pending?.tool.name ?? "" })}
        </p>
        <pre
          className="m-0 max-h-[160px] overflow-auto whitespace-pre-wrap break-all border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-[var(--space-2)] font-mono text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {pending?.command ?? ""}
        </pre>
        <Switch
          checked={remember}
          label={t("externalTool.rememberChoice")}
          onCheckedChange={setRemember}
        />
      </div>
    </Modal>
  );
}
