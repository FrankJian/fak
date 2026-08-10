/**
 * 设置界面里的一行（SPEC F11 步骤 2）。
 *
 * 「名称 + 说明 + 控件」的版式，右侧固定宽度放控件，左侧说明可换行。
 * 值与默认值不同时才出现「重置此项」，一直显示会让整页都是图标。
 */
import { useState } from "react";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { Select } from "../design/components/Select";
import { Switch } from "../design/components/Switch";
import { useTranslation } from "../i18n/useTranslation";
import type { Config } from "../ipc/config";
import { clampNumber, type SettingDescriptor } from "../lib/settingsSchema";

interface SettingsFieldProps {
  setting: SettingDescriptor;
  config: Config;
  onPatch: (patch: Partial<Config>) => void;
  highlightQuery?: string;
  /** 关掉数据保护类开关前的确认。返回 false 表示用户反悔了 */
  onConfirm: (message: string) => boolean;
}

export function SettingsField({
  setting,
  config,
  onPatch,
  onConfirm,
  highlightQuery,
}: SettingsFieldProps) {
  const { t } = useTranslation();
  const modified = isModified(setting, config);

  return (
    <div
      id={`setting-${setting.id}`}
      className={[
        "flex items-start justify-between gap-[var(--space-4)]",
        highlightQuery?.trim() ? "bg-[var(--match-other-bg)]" : "",
      ].join(" ")}
      style={{ paddingTop: "var(--space-2)", paddingBottom: "var(--space-2)" }}
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={`control-${setting.id}`}
          className="block text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-ui)" }}
        >
          {highlightText(t(setting.labelKey), highlightQuery)}
        </label>
        <p
          className="m-0 text-[var(--text-tertiary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {highlightText(t(setting.descriptionKey), highlightQuery)}
        </p>
      </div>

      <div
        className="flex shrink-0 items-center gap-[var(--space-2)]"
        style={{ width: 240 }}
      >
        <div className="min-w-0 flex-1">
          <Control
            setting={setting}
            config={config}
            onPatch={onPatch}
            onConfirm={onConfirm}
          />
        </div>
        {/* 位置固定占住，出现与消失时右边缘不会跳 */}
        <span className="flex" style={{ width: "var(--h-icon-button)" }}>
          {modified && (
            <IconButton
              icon="restore"
              label={t("settings.reset")}
              onClick={() => onPatch(resetPatch(setting, config))}
            />
          )}
        </span>
      </div>
    </div>
  );
}

function highlightText(text: string, query: string | undefined) {
  const needle = query?.trim();
  if (!needle) return text;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerNeedle, cursor);

  while (index >= 0) {
    if (index > cursor) fragments.push(text.slice(cursor, index));
    fragments.push(
      <mark
        key={index}
        className="bg-[var(--match-other-bg)] text-[var(--text-primary)]"
      >
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor === 0) return text;
  if (cursor < text.length) fragments.push(text.slice(cursor));
  return fragments;
}

function Control({ setting, config, onPatch, onConfirm }: SettingsFieldProps) {
  const { t } = useTranslation();
  const id = `control-${setting.id}`;

  if (setting.kind === "switch") {
    const checked = setting.read(config);
    return (
      <Switch
        checked={checked}
        label={t(setting.labelKey)}
        onCheckedChange={(next) => {
          // 关掉备份是会让用户丢数据的操作，先问一句（SPEC F11 步骤 7）
          if (
            !next &&
            setting.warnOnDisableKey &&
            !onConfirm(t(setting.warnOnDisableKey))
          )
            return;
          onPatch(setting.write(next, config));
        }}
      />
    );
  }

  if (setting.kind === "select") {
    return (
      <Select
        id={id}
        value={setting.read(config)}
        onValueChange={(next) => onPatch(setting.write(next))}
        options={setting.options.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        className="w-full"
      />
    );
  }

  if (setting.kind === "number") {
    return (
      <NumberControl setting={setting} config={config} onPatch={onPatch} />
    );
  }

  return <TextControl setting={setting} config={config} onPatch={onPatch} />;
}

type ControlProps<T extends SettingDescriptor> = {
  setting: T;
  config: Config;
  onPatch: (patch: Partial<Config>) => void;
};

/**
 * 数值输入在**失焦或回车时**才钳制并落盘。
 *
 * 边打边钳制的话，想把 20 改成 5 时中途的 `2` 会被立刻改写成下限，
 * 光标位置也跟着乱跳。
 */
function NumberControl({
  setting,
  config,
  onPatch,
}: ControlProps<Extract<SettingDescriptor, { kind: "number" }>>) {
  const { t } = useTranslation();
  const stored = setting.read(config) / setting.scale;
  const [draft, setDraft] = useDraft(String(stored), stored);

  const commit = () => {
    const parsed = Number(draft);
    const clamped = clampNumber(
      setting,
      Number.isFinite(parsed) ? parsed * setting.scale : NaN,
    );
    onPatch(setting.write(clamped));
    setDraft(String(clamped / setting.scale));
  };

  return (
    <span className="flex items-center gap-[var(--space-2)]">
      <Input
        id={`control-${setting.id}`}
        type="number"
        inputMode="decimal"
        className="tabular-nums"
        min={setting.min / setting.scale}
        max={setting.max / setting.scale}
        step={setting.step / setting.scale}
        title={t("settings.range", {
          min: String(setting.min / setting.scale),
          max: String(setting.max / setting.scale),
        })}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      {setting.unitKey && (
        <span
          className="shrink-0 text-[var(--text-tertiary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t(setting.unitKey)}
        </span>
      )}
    </span>
  );
}

/** 文本项同样在失焦时落盘：逐字符落盘会把「标尺列」写成一堆半截状态。 */
function TextControl({
  setting,
  config,
  onPatch,
}: ControlProps<Extract<SettingDescriptor, { kind: "text" }>>) {
  const stored = setting.read(config);
  const [draft, setDraft] = useDraft(stored, stored);

  return (
    <Input
      id={`control-${setting.id}`}
      mono={setting.mono}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onPatch(setting.write(draft))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onPatch(setting.write(draft));
      }}
    />
  );
}

/**
 * 输入框在编辑期间只认自己的草稿，外部改动（热重载、「重置此项」）落地时才跟随。
 * 用渲染期同步而不是 effect：effect 版本会先用旧值渲染一帧，光标随之跳到末尾。
 */
function useDraft<T>(next: T, token: unknown): [T, (value: T) => void] {
  const [draft, setDraft] = useState(next);
  const [seen, setSeen] = useState(token);

  if (seen !== token) {
    setSeen(token);
    setDraft(next);
  }

  return [draft, setDraft];
}

function isModified(setting: SettingDescriptor, config: Config): boolean {
  return setting.read(config) !== setting.defaultValue;
}

/**
 * 每个分支都是同一句 `write(defaultValue)`，但必须逐个写开：
 * `write` 是一组入参类型不同的函数的联合，不先收窄就调不动。
 */
function resetPatch(
  setting: SettingDescriptor,
  config: Config,
): Partial<Config> {
  if (setting.kind === "switch")
    return setting.write(setting.defaultValue, config);
  if (setting.kind === "number") return setting.write(setting.defaultValue);
  return setting.write(setting.defaultValue);
}
