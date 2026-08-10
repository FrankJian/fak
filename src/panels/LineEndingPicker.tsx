/**
 * 换行符选择（SPEC F1.3）。
 *
 * 换行符**只影响写盘时的形态**：LF / CRLF 在 rope 里统一归一成 LF，
 * 切换它不重新解码、不丢修改，所以这里不需要编码面板那样的警告。
 */
import type { RefObject } from "react";
import { Icon } from "../design/Icon";
import { Popover } from "../design/components/Popover";
import { useTranslation } from "../i18n/useTranslation";
import type { MessageKey } from "../i18n";
import type { LineEnding } from "../ipc/documents";

const OPTIONS: ReadonlyArray<{ value: LineEnding; labelKey: MessageKey }> = [
  { value: "lf", labelKey: "lineEnding.lf" },
  { value: "crLf", labelKey: "lineEnding.crLf" },
  { value: "cr", labelKey: "lineEnding.cr" },
];

interface LineEndingPickerProps {
  open: boolean;
  current: LineEnding;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onPick: (lineEnding: LineEnding) => void;
  onClose: () => void;
}

export function LineEndingPicker({
  open,
  current,
  anchorRef,
  onPick,
  onClose,
}: LineEndingPickerProps) {
  const { t } = useTranslation();

  return (
    <Popover
      open={open}
      anchorRef={anchorRef}
      ariaLabel={t("lineEnding.title")}
      onClose={onClose}
    >
      <ul className="m-0 flex list-none flex-col p-[var(--space-3)]">
        {OPTIONS.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              onClick={() => onPick(option.value)}
              aria-current={option.value === current}
              className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              style={{ height: "var(--h-row)" }}
            >
              <span className="w-[var(--space-5)] shrink-0">
                {option.value === current && (
                  <Icon name="check" variant="menu" />
                )}
              </span>
              {t(option.labelKey)}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
