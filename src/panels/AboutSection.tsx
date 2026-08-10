/**
 * 「关于」（SPEC F11 分组 K、§10.1）。
 *
 * 版本号**运行时读取**，不写死也不做构建期注入（AGENTS.md §3.2）。
 * 日志隐私说明必须在这里出现：让用户在贴日志之前就知道里面有什么、没有什么。
 */
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "../design/components/Button";
import { useTranslation } from "../i18n/useTranslation";
import { configFilePath, logDirectory } from "../ipc/config";
import { takeUpdateOutcome, type UpdateOutcomeReport } from "../ipc/update";
import { revealInFileManager } from "../ipc/opener";
import { isTauriAvailable } from "../ipc/invoke";
import { logger } from "../lib/logger";
import appIconUrl from "../../src-tauri/icons/icon.svg?url";

interface AboutSectionProps {
  onCheckForUpdates: () => void;
}

export function AboutSection({ onCheckForUpdates }: AboutSectionProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [outcome, setOutcome] = useState<UpdateOutcomeReport | null>(null);
  const [paths, setPaths] = useState<{ config: string; logs: string } | null>(
    null,
  );

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void Promise.all([getVersion(), configFilePath(), logDirectory()])
      .then(([appVersion, config, logs]) => {
        if (cancelled) return;
        setVersion(appVersion);
        setPaths({ config, logs });
      })
      .catch((error: unknown) => logger.warn("about info failed", error));
    // 读一次就消耗掉成功状态，所以单独发起，不跟上面那组共用一个 Promise.all
    void takeUpdateOutcome()
      .then((report) => {
        if (!cancelled) setOutcome(report);
      })
      .catch((error: unknown) => logger.warn("update outcome failed", error));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {outcome && (
        <p
          role="status"
          className={`m-0 ${outcome.succeeded ? "text-[var(--text-secondary)]" : "text-[var(--danger)]"}`}
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t(
            outcome.succeeded ? "about.updateSucceeded" : "about.updateFailed",
            { version: outcome.version },
          )}
        </p>
      )}
      <div className="flex items-center gap-[var(--space-4)]">
        <img
          alt=""
          aria-hidden="true"
          className="shrink-0"
          draggable={false}
          src={appIconUrl}
          style={{
            height: "calc(var(--space-7) * 2)",
            width: "calc(var(--space-7) * 2)",
          }}
        />
        <div>
          <p
            className="m-0 text-[var(--text-primary)]"
            style={{ fontSize: "var(--font-size-ui)" }}
          >
            {t("app.name")}
          </p>
          <p
            className="m-0 tabular-nums text-[var(--text-secondary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {version ? t("about.version", { version }) : ""}
          </p>
        </div>
      </div>

      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("about.privacy")}
      </p>

      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("about.logPrivacy")}
      </p>

      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Button variant="strong" onClick={onCheckForUpdates}>
          {t("update.check")}
        </Button>
        <Button
          disabled={!paths}
          onClick={() => {
            if (paths) void revealInFileManager(paths.logs);
          }}
        >
          {t("about.openLogDirectory")}
        </Button>
        <Button
          disabled={!paths}
          onClick={() => {
            if (paths) void revealInFileManager(paths.config);
          }}
        >
          {t("about.openConfigLocation")}
        </Button>
      </div>
    </div>
  );
}
