/**
 * 更新弹窗（SPEC §12.3.3）。
 *
 * 「立即更新」是一气呵成的：下载 → 保存确认 → 安装 → 重启，
 * 中途不再需要用户点第二次。破坏性 / 重要操作按钮一律用文字（SPEC §6.6.1）。
 */
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";
import type { MessageKey } from "../i18n";
import { formatBytes } from "../lib/format";
import {
  isRetryable,
  needsManualDownload,
  type UpdateFailureReason,
} from "../lib/updateFailure";
import { openExternalUrl } from "../ipc/opener";
import { RELEASE_PAGE_URL } from "../ipc/update";
import type { UpdateFlow } from "../app/useUpdateFlow";

const FAILURE_MESSAGE: Record<UpdateFailureReason, MessageKey> = {
  signature: "update.failed.signature",
  sizeMismatch: "update.failed.sizeMismatch",
  notWritable: "update.failed.notWritable",
  mountedVolume: "update.failed.mountedVolume",
  network: "update.failed.network",
};

interface UpdateDialogProps {
  flow: UpdateFlow;
  currentVersion: string;
  onOpenSettings: () => void;
}

export function UpdateDialog({
  flow,
  currentVersion,
  onOpenSettings,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const { phase } = flow;
  const busy = phase.kind === "downloading" || phase.kind === "installing";

  const title =
    phase.kind === "failed"
      ? t("update.failedTitle")
      : phase.kind === "upToDate"
        ? t("update.upToDateTitle")
        : t("update.availableTitle");

  return (
    <Modal
      open={flow.prompting}
      title={title}
      widthPx={480}
      closeOnScrimClick={!busy}
      onClose={flow.dismiss}
      footer={<Footer flow={flow} onOpenSettings={onOpenSettings} />}
    >
      {phase.kind === "upToDate" && (
        <p className="m-0 text-[var(--text-secondary)]">
          {t("update.upToDate", { version: currentVersion })}
        </p>
      )}

      {phase.kind === "checking" && (
        <p className="m-0 text-[var(--text-secondary)]">
          {t("update.checking")}
        </p>
      )}

      {phase.kind === "failed" && (
        <p className="m-0 text-[var(--danger)]" role="alert">
          {t(FAILURE_MESSAGE[phase.reason])}
        </p>
      )}

      {(phase.kind === "available" ||
        phase.kind === "downloading" ||
        phase.kind === "installing") && (
        <div className="flex flex-col gap-[var(--space-3)]">
          <p className="m-0 tabular-nums text-[var(--text-primary)]">
            {t("update.versionTransition", {
              current: currentVersion,
              next: phase.update.version,
            })}
          </p>
          {phase.update.date && (
            <p
              className="m-0 tabular-nums text-[var(--text-secondary)]"
              style={{ fontSize: "var(--font-size-small)" }}
            >
              {phase.update.date}
            </p>
          )}
          {phase.update.body && (
            <div
              className="overflow-y-auto whitespace-pre-wrap text-[var(--text-secondary)]"
              style={{ maxHeight: 200, fontSize: "var(--font-size-small)" }}
            >
              {phase.update.body}
            </div>
          )}

          {phase.kind === "downloading" && (
            <div
              aria-live="polite"
              className="flex flex-col gap-[var(--space-1)]"
            >
              <div
                className="h-[4px] w-full overflow-hidden rounded-[2px] bg-[var(--bg-inset)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={phase.total ?? undefined}
                aria-valuenow={phase.downloaded}
              >
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{
                    width: phase.total
                      ? `${Math.min(100, Math.round((phase.downloaded / phase.total) * 100))}%`
                      : "100%",
                  }}
                />
              </div>
              <span
                className="tabular-nums text-[var(--text-secondary)]"
                style={{ fontSize: "var(--font-size-small)" }}
              >
                {t("update.downloaded", {
                  done: formatBytes(phase.downloaded),
                  total: phase.total ? formatBytes(phase.total) : "—",
                })}
              </span>
            </div>
          )}

          {phase.kind === "installing" && (
            <p aria-live="polite" className="m-0 text-[var(--text-secondary)]">
              {t("update.installing")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Footer({
  flow,
  onOpenSettings,
}: {
  flow: UpdateFlow;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const { phase } = flow;
  const busy = phase.kind === "downloading" || phase.kind === "installing";

  if (phase.kind === "failed") {
    return (
      <>
        {needsManualDownload(phase.reason) && (
          <Button onClick={() => void openExternalUrl(RELEASE_PAGE_URL)}>
            {t("update.manualDownload")}
          </Button>
        )}
        {phase.reason === "network" && (
          <Button onClick={onOpenSettings}>{t("update.configureProxy")}</Button>
        )}
        {/* 签名校验失败没有「忽略」这个选项（SPEC §12.3.4 第 1 条） */}
        {isRetryable(phase.reason) ? (
          <Button variant="strong" onClick={flow.checkNow}>
            {t("update.retry")}
          </Button>
        ) : (
          <Button variant="strong" onClick={flow.dismiss}>
            {t("dialog.close")}
          </Button>
        )}
      </>
    );
  }

  if (phase.kind === "available" || busy) {
    return (
      <>
        <Button disabled={busy} onClick={flow.skipVersion}>
          {t("update.skipVersion")}
        </Button>
        <Button disabled={busy} onClick={flow.remindLater}>
          {t("update.remindLater")}
        </Button>
        <Button variant="strong" disabled={busy} onClick={flow.install}>
          {busy ? t("update.installingShort") : t("update.installNow")}
        </Button>
      </>
    );
  }

  return (
    <Button variant="strong" onClick={flow.dismiss}>
      {t("dialog.close")}
    </Button>
  );
}
