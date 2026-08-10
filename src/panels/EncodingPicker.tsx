/**
 * 编码选择（SPEC F1.2）。
 *
 * 这个面板最要紧的一件事，是把**两个动作的区别当面讲清楚**：
 * 「保存为此编码」不动正文，只改下次写盘时用的编码；
 * 「以此编码重新打开」丢掉未保存的修改，从磁盘原始字节重新解码。
 * 选错一个白忙一场，选错另一个丢修改，所以两句说明必须并排摆着。
 */
import { useEffect, useState, type RefObject } from "react";
import { Icon } from "../design/Icon";
import { Popover } from "../design/components/Popover";
import { SegmentedControl } from "../design/components/SegmentedControl";
import { useTranslation } from "../i18n/useTranslation";
import { listEncodings } from "../ipc/documents";
import { logger } from "../lib/logger";

type Intent = "convert" | "reopen";

interface EncodingPickerProps {
  open: boolean;
  current: string;
  /** 低置信度时把猜测结果标出来，提示用户可能需要换一种 */
  lowConfidence: boolean;
  isDirty: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onPick: (encoding: string, intent: Intent) => void;
  onClose: () => void;
}

export function EncodingPicker({
  open,
  current,
  lowConfidence,
  isDirty,
  anchorRef,
  onPick,
  onClose,
}: EncodingPickerProps) {
  const { t } = useTranslation();
  const [intent, setIntent] = useState<Intent>("convert");
  const [encodings, setEncodings] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listEncodings()
      .then((list) => {
        if (!cancelled) setEncodings(list);
      })
      .catch((error: unknown) =>
        logger.warn("failed to list encodings", error),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Popover
      open={open}
      anchorRef={anchorRef}
      ariaLabel={t("encoding.title")}
      onClose={onClose}
      widthPx={420}
    >
      <div className="flex flex-col gap-[var(--space-4)] p-[var(--space-5)]">
        <SegmentedControl
          value={intent}
          onValueChange={setIntent}
          label={t("encoding.title")}
          options={[
            { value: "convert", label: t("encoding.convert") },
            { value: "reopen", label: t("encoding.reopen") },
          ]}
        />

        <p
          className="m-0 text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t(
            intent === "convert"
              ? "encoding.convertHint"
              : "encoding.reopenHint",
          )}
        </p>

        {lowConfidence && (
          <p
            className="m-0 flex items-center gap-[var(--space-2)]"
            style={{
              fontSize: "var(--font-size-small)",
              color: "var(--warning)",
            }}
          >
            <Icon name="warning" variant="menu" />
            {t("encoding.lowConfidence")}
          </p>
        )}

        {intent === "reopen" && isDirty && (
          <p
            className="m-0 flex items-center gap-[var(--space-2)]"
            style={{
              fontSize: "var(--font-size-small)",
              color: "var(--danger)",
            }}
          >
            <Icon name="warning" variant="menu" />
            {t("encoding.reopenWarning")}
          </p>
        )}

        <ul className="m-0 flex max-h-[40vh] list-none flex-col overflow-auto p-0">
          {encodings.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onPick(name, intent)}
                aria-current={name === current}
                className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
                style={{ height: "var(--h-row)" }}
              >
                <span className="w-[var(--space-5)] shrink-0">
                  {name === current && <Icon name="check" variant="menu" />}
                </span>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
