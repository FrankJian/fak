/**
 * 更新代理设置（SPEC §12.3.2）。
 *
 * 国内网络下这是刚需，不是可选项：清单与安装包都可能只能走代理。
 *
 * 「测试连接」**只请求清单**，不下载安装包——用户点它是想知道「通不通」，
 * 不是想先下 30 MB。代理串可能带账号密码，报错与日志里都不回显它。
 */
import { useState } from "react";
import { Button } from "../design/components/Button";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import { describeProxy, isValidProxy } from "../lib/updateProxy";
import { testUpdateEndpoint } from "../ipc/update";
import { logger } from "../lib/logger";

interface UpdateProxyFieldProps {
  value: string;
  ignoreSystemProxy: boolean;
  onChange: (next: string) => void;
}

type Probe =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; status: number; elapsedMs: number }
  | { state: "failed"; detail: string };

export function UpdateProxyField({
  value,
  ignoreSystemProxy,
  onChange,
}: UpdateProxyFieldProps) {
  const { t } = useTranslation();
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const invalid = !isValidProxy(value);

  const test = () => {
    setProbe({ state: "running" });
    void testUpdateEndpoint(ignoreSystemProxy ? "" : value.trim())
      .then((result) =>
        setProbe({
          state: "ok",
          status: result.status,
          elapsedMs: result.elapsedMs,
        }),
      )
      .catch((error: unknown) => {
        logger.warn(
          `update endpoint probe failed (proxy ${describeProxy(value)})`,
        );
        setProbe({
          state: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return (
    <div className="flex flex-col gap-[var(--space-2)] py-[var(--space-2)]">
      <label
        className="text-[var(--text-primary)]"
        style={{ fontSize: "var(--font-size-ui)" }}
      >
        {t("settings.updateProxyServer.label")}
      </label>
      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("settings.updateProxyServer.description")}
      </p>

      <div className="flex items-center gap-[var(--space-2)]">
        <span className="min-w-0 flex-1">
          <Input
            mono
            value={value}
            invalid={invalid}
            disabled={ignoreSystemProxy}
            placeholder={t("settings.updateProxyServer.placeholder")}
            aria-label={t("settings.updateProxyServer.label")}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
        <Button disabled={invalid || probe.state === "running"} onClick={test}>
          {t("settings.updateProxy.test")}
        </Button>
      </div>

      {invalid && (
        <p
          role="alert"
          className="m-0 text-[var(--danger)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("settings.updateProxy.invalid")}
        </p>
      )}

      {probe.state === "ok" && (
        <p
          role="status"
          className="m-0 tabular-nums text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("settings.updateProxy.ok", {
            status: probe.status,
            ms: probe.elapsedMs,
          })}
        </p>
      )}

      {probe.state === "failed" && (
        <p
          role="alert"
          className="m-0 text-[var(--danger)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("settings.updateProxy.failed")}
        </p>
      )}
    </div>
  );
}
