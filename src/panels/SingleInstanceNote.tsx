/**
 * 单实例开关的重启提示（SPEC §12.5 第 3 条：切换需重启生效，UI 必须明确提示）。
 *
 * 比对的是**本次启动实际生效的值**与配置里的值，而不是「用户刚才动过没有」——
 * 后者在设置窗口重开一次之后就忘了，用户会以为已经生效。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { isTauriAvailable } from "../ipc/invoke";
import { singleInstanceActive } from "../ipc/shellIntegration";
import { useAppStore } from "../store/appStore";
import { logger } from "../lib/logger";

export function SingleInstanceNote() {
  const { t } = useTranslation();
  const configured = useAppStore((state) => state.singleInstance);
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void singleInstanceActive()
      .then((value) => {
        if (!cancelled) setActive(value);
      })
      .catch((error: unknown) => logger.warn("single instance state", error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (active === null || active === configured) return null;

  return (
    <p
      role="status"
      className="m-0 text-[var(--warning)]"
      style={{ fontSize: "var(--font-size-small)" }}
    >
      {t("settings.singleInstance.restartRequired")}
    </p>
  );
}
