/**
 * 外壳集成开关（SPEC §12.4）。
 *
 * 单独渲染而不是走 `settingsSchema`：它的真相源是注册表而不是配置文件，
 * 当成普通配置项会出现「配置里写着开、系统里其实没注册」的分歧。
 */
import { useEffect, useState } from "react";
import { Button } from "../design/components/Button";
import { useTranslation } from "../i18n/useTranslation";
import { isTauriAvailable } from "../ipc/invoke";
import {
  registerShellIntegration,
  shellIntegrationStatus,
  unregisterShellIntegration,
} from "../ipc/shellIntegration";
import { logger } from "../lib/logger";

export function ShellIntegrationField() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{
    registered: boolean;
    supported: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void shellIntegrationStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) =>
        logger.warn("shell integration status", error),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.supported) return null;

  const toggle = () => {
    setBusy(true);
    const action = status.registered
      ? unregisterShellIntegration()
      : registerShellIntegration(t("shellIntegration.menuLabel"));
    void action
      .then(() => shellIntegrationStatus())
      .then(setStatus)
      .catch((error: unknown) => logger.warn("shell integration toggle", error))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-[var(--space-2)] py-[var(--space-2)]">
      <span
        className="text-[var(--text-primary)]"
        style={{ fontSize: "var(--font-size-ui)" }}
      >
        {t("shellIntegration.label")}
      </span>
      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("shellIntegration.description")}
      </p>
      <div>
        <Button disabled={busy} onClick={toggle}>
          {t(
            status.registered
              ? "shellIntegration.unregister"
              : "shellIntegration.register",
          )}
        </Button>
      </div>
    </div>
  );
}
