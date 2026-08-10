/**
 * 外部工具选择器（SPEC F15 步骤 6）。
 *
 * 工具是用户自定义的，名字不是 i18n key，没法逐个静态注册进命令面板；
 * 所以命令面板里是一条固定入口，具体选哪个工具在这里选。
 */
import { Icon } from "../design/Icon";
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";
import type { ExternalTool } from "../ipc/config";

interface ExternalToolPickerProps {
  open: boolean;
  tools: readonly ExternalTool[];
  running: string | null;
  onRun: (tool: ExternalTool) => void;
  onClose: () => void;
}

export function ExternalToolPicker({
  open,
  tools,
  running,
  onRun,
  onClose,
}: ExternalToolPickerProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t("externalTool.pickerTitle")}
      onClose={onClose}
      footer={
        <Button variant="quiet" onClick={onClose}>
          {t("dialog.close")}
        </Button>
      }
    >
      {tools.length === 0 ? (
        <p
          className="m-0 text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("externalTool.empty")}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              disabled={running !== null}
              onClick={() => {
                onRun(tool);
                onClose();
              }}
              className="flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-left hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            >
              <Icon name="externalTool" variant="menu" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--text-primary)]">
                  {tool.name}
                </span>
                <span
                  className="block truncate font-mono text-[var(--text-tertiary)]"
                  style={{ fontSize: "var(--font-size-small)" }}
                >
                  {tool.command}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
