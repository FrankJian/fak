/**
 * 自绘标题栏（SPEC §5.1）。窗口装饰关掉后，拖拽区、双击最大化、
 * 三个窗口按钮都要自己来。
 */
import { useEffect, useState } from "react";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { getWindowControls } from "../ipc/window";

export function TitleBar({
  title,
  onOpenMenu,
}: {
  title: string;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const controls = getWindowControls();

  useEffect(() => {
    let cancelled = false;
    void controls.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    return () => {
      cancelled = true;
    };
  }, [controls]);

  const toggleMaximize = async () => {
    await controls.toggleMaximize();
    setMaximized(await controls.isMaximized());
  };

  return (
    <header
      className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-3"
      style={{ height: "var(--h-titlebar)" }}
      data-tauri-drag-region
    >
      <span
        className="flex size-[var(--h-icon-button)] shrink-0 items-center justify-center text-[var(--text-primary)]"
        aria-label={t("app.name")}
        style={{ fontWeight: "var(--weight-strong)" }}
      >
        F
      </span>
      <IconButton
        icon="menu"
        label={t("commandPalette.open")}
        onClick={onOpenMenu}
      />
      <span
        className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
        data-tauri-drag-region
      >
        {title}
      </span>

      <IconButton
        icon="minimizeWindow"
        label={t("titleBar.minimize")}
        onClick={() => void controls.minimize()}
      />
      <IconButton
        icon={maximized ? "restoreWindow" : "maximizeWindow"}
        label={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
        onClick={() => void toggleMaximize()}
      />
      <IconButton
        icon="closeWindow"
        label={t("titleBar.close")}
        onClick={() => void controls.close()}
      />
    </header>
  );
}
