/**
 * 设置窗口（SPEC F11）。
 *
 * 左侧分类导航（**保留文字**，SPEC §6.6.1 的「必须保留文字」清单）、右侧表单，
 * 顶部一个搜索框。没有「保存」按钮：改动即时生效并即时落盘（`patchConfig`
 * 自带 200 ms 防抖），这是 SPEC F11 步骤 2 的明确要求。
 *
 * 搜索有内容时**忽略左侧分类**，把命中项按分组平铺出来——
 * 用户搜「备份」时想要的是那几项，而不是「它们在哪个分类里」。
 */
import { useMemo, useState } from "react";
import { Button } from "../design/components/Button";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { Modal } from "../design/components/Modal";
import { Icon } from "../design/Icon";
import { useTranslation } from "../i18n/useTranslation";
import type { Config } from "../ipc/config";
import { useAppStore } from "../store/appStore";
import {
  SETTINGS,
  SETTINGS_GROUPS,
  groupSettingsByGroup,
  searchSettings,
  type SettingDescriptor,
  type SettingsGroup,
} from "../lib/settingsSchema";
import { SettingsField } from "./SettingsField";
import { ExternalToolsEditor } from "./ExternalToolsEditor";
import { AboutSection } from "./AboutSection";
import { UpdateProxyField } from "./UpdateProxyField";
import { ShellIntegrationField } from "./ShellIntegrationField";
import { SingleInstanceNote } from "./SingleInstanceNote";
import { ShortcutSettings } from "./ShortcutSettings";

interface SettingsWindowProps {
  initialGroup?: SettingsGroup;
  /** 「以文件方式打开配置」——SPEC §9.3 第 8 条的逃生舱，右上角常驻 */
  onOpenFile: () => void;
  onCheckForUpdates: () => void;
  onClose: () => void;
}

/**
 * 只在打开时挂载。直接向 store 订阅整份配置而不是从 App 逐字段传下来：
 * 这里本来就要读几乎所有字段，逐字段传只是把同一份订阅拆成二十几个 prop。
 */
export function SettingsWindow({
  initialGroup = "general",
  onOpenFile,
  onCheckForUpdates,
  onClose,
}: SettingsWindowProps) {
  const { t } = useTranslation();
  const config = useAppStore((state) => state as Config);
  const onPatch = useAppStore((state) => state.patchConfig);
  const [group, setGroup] = useState<SettingsGroup>(initialGroup);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => searchSettings(SETTINGS, query, t), [query, t]);
  const searching = query.trim().length > 0;
  const visible = searching
    ? matches
    : matches.filter((item) => item.group === group);
  const groupedMatches = useMemo(
    () => groupSettingsByGroup(matches),
    [matches],
  );
  // 外部工具等不是标量设置项，各自有一段自绘 UI；分组里没有别的项时也要显示
  const hasCustomSection =
    !searching &&
    (group === "tools" ||
      group === "shortcuts" ||
      group === "updates" ||
      group === "general" ||
      group === "about");

  // 用系统确认框而不是自绘对话框：它开在模态之上，自绘的话两层 Modal
  // 会争抢 Escape 与焦点陷阱。这是一处有意的样式妥协，已记在 tasks 里
  const confirm = (message: string) => window.confirm(message);

  const resetAll = () => {
    if (!confirm(t("settings.resetAllConfirm"))) return;
    let patch: Partial<Config> = {};
    for (const setting of SETTINGS)
      patch = { ...patch, ...defaultPatch(setting, config) };
    onPatch(patch);
  };

  return (
    <Modal
      open
      title={t("settings.title")}
      onClose={onClose}
      widthPx={760}
      footer={
        <>
          {/* 「全部重置」是破坏性动作，必须是文字按钮（SPEC §6.6.1） */}
          <Button variant="danger" onClick={resetAll}>
            {t("settings.resetAll")}
          </Button>
          <Button variant="strong" onClick={onClose}>
            {t("dialog.close")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Input
            leadingIcon="find"
            aria-label={t("settings.search")}
            placeholder={t("settings.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            icon="settings"
            label={t("settings.openFile")}
            onClick={onOpenFile}
          />
        </div>

        <div className="flex min-h-0 gap-[var(--space-5)]">
          <nav
            aria-label={t("settings.title")}
            className="flex shrink-0 flex-col gap-[var(--space-1)]"
            style={{ width: 148 }}
          >
            {SETTINGS_GROUPS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={!searching && entry.id === group}
                onClick={() => {
                  setQuery("");
                  setGroup(entry.id);
                }}
                className={[
                  "flex items-center gap-[var(--space-2)] rounded-[var(--radius-control)] text-left",
                  !searching && entry.id === group
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]",
                ].join(" ")}
                style={{
                  height: "var(--h-row)",
                  paddingLeft: "var(--space-2)",
                  paddingRight: "var(--space-2)",
                  fontSize: "var(--font-size-ui)",
                }}
              >
                <Icon name={entry.icon} variant="menu" />
                <span className="truncate">{t(entry.labelKey)}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
              {visible.length === 0 && !hasCustomSection ? (
                <p
                  className="m-0 text-[var(--text-tertiary)]"
                  style={{ fontSize: "var(--font-size-small)" }}
                >
                  {t("settings.noMatch")}
                </p>
              ) : searching ? (
                <div className="flex flex-col gap-[var(--space-4)]">
                  {groupedMatches.map(({ group: matchGroup, settings }) => (
                    <section
                      key={matchGroup.id}
                      aria-label={t(matchGroup.labelKey)}
                    >
                      <h2
                        className="m-0 flex items-center gap-[var(--space-2)] text-[var(--text-secondary)]"
                        style={{ fontSize: "var(--font-size-small)" }}
                      >
                        <Icon name={matchGroup.icon} variant="menu" />
                        {t(matchGroup.labelKey)}
                      </h2>
                      <div className="mt-[var(--space-1)] flex flex-col divide-y divide-[var(--border-subtle)]">
                        {settings.map((setting) => (
                          <SettingsField
                            key={setting.id}
                            setting={setting}
                            config={config}
                            onPatch={onPatch}
                            onConfirm={confirm}
                            highlightQuery={query}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {visible.map((setting) => (
                    <SettingsField
                      key={setting.id}
                      setting={setting}
                      config={config}
                      onPatch={onPatch}
                      onConfirm={confirm}
                    />
                  ))}
                  {group === "shortcuts" && <ShortcutSettings />}
                  {group === "tools" && (
                    <div className="py-[var(--space-2)]">
                      <ExternalToolsEditor
                        tools={config.externalTools}
                        onChange={(next) => onPatch({ externalTools: next })}
                      />
                    </div>
                  )}
                  {group === "general" && (
                    <>
                      <SingleInstanceNote />
                      <ShellIntegrationField />
                    </>
                  )}
                  {group === "updates" && (
                    <UpdateProxyField
                      value={config.updateProxyServer}
                      ignoreSystemProxy={config.updateIgnoreSystemProxy}
                      onChange={(next) => onPatch({ updateProxyServer: next })}
                    />
                  )}
                  {group === "about" && (
                    <div className="py-[var(--space-2)]">
                      <AboutSection onCheckForUpdates={onCheckForUpdates} />
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function defaultPatch(
  setting: SettingDescriptor,
  config: Config,
): Partial<Config> {
  if (setting.kind === "switch")
    return setting.write(setting.defaultValue, config);
  if (setting.kind === "number") return setting.write(setting.defaultValue);
  return setting.write(setting.defaultValue);
}
