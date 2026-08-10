/**
 * 手势绑定表（SPEC F12 步骤 4）。
 *
 * 序列用 `U/D/L/R` 的紧凑写法录入：录制式 UI 在一个模态里再套一层「按住右键拖拽」
 * 会和模态自身的指针捕获打架，而这四个字母足够短，直接敲比划一遍还快。
 */
import { useState } from "react";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { Select } from "../design/components/Select";
import { useTranslation } from "../i18n/useTranslation";
import { listActions } from "../lib/actionRegistry";
import {
  gestureFromCode,
  gestureToCode,
  resolveGestures,
} from "../lib/mouseGestures";

interface GestureBindingsProps {
  overrides: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

export function GestureBindings({ overrides, onChange }: GestureBindingsProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const bindings = resolveGestures(overrides);
  const actions = listActions();

  const invalid = draft.trim().length > 0 && gestureFromCode(draft) === null;

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("settings.gesture.hint")}
      </p>

      <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
        {bindings.map((binding) => {
          const code = gestureToCode(binding.sequence);
          return (
            <div
              key={code}
              className="flex items-center gap-[var(--space-3)] py-[var(--space-1)]"
            >
              <span className="w-[72px] shrink-0 font-mono text-[var(--text-primary)]">
                {code}
              </span>
              <span className="min-w-0 flex-1">
                <Select
                  aria-label={t("settings.gesture.action")}
                  value={binding.actionId}
                  onValueChange={(next) =>
                    onChange({ ...overrides, [code]: next })
                  }
                  options={actions.map((action) => ({
                    value: action.id,
                    label: t(action.titleKey),
                  }))}
                  className="w-full"
                />
              </span>
              <IconButton
                icon="close"
                label={t("settings.gesture.remove")}
                // 空动作 id 表示「关掉这条默认手势」，删除键在这里等于停用
                onClick={() => onChange({ ...overrides, [code]: "" })}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-[var(--space-2)]">
        <span className="w-[120px] shrink-0">
          <Input
            mono
            value={draft}
            invalid={invalid}
            placeholder={t("settings.gesture.sequencePlaceholder")}
            aria-label={t("settings.gesture.sequence")}
            onChange={(event) => setDraft(event.target.value)}
          />
        </span>
        <IconButton
          icon="add"
          label={t("settings.gesture.add")}
          disabled={invalid || draft.trim().length === 0}
          onClick={() => {
            const sequence = gestureFromCode(draft);
            if (!sequence) return;
            onChange({
              ...overrides,
              [gestureToCode(sequence)]: actions[0]?.id ?? "",
            });
            setDraft("");
          }}
        />
      </div>
    </div>
  );
}
