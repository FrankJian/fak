/**
 * 外部工具的增删改（SPEC F11 分组 G、F15 步骤 1）。
 *
 * 命令**原样展示**且不做任何解释：Rust 侧只把它拆成程序名与参数数组，
 * 这里若替用户「补全」引号或变量，展示的就不再是真正会执行的东西。
 */
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { Select } from "../design/components/Select";
import { useTranslation } from "../i18n/useTranslation";
import type {
  ExternalTool,
  ExternalToolCwd,
  ExternalToolInput,
  ExternalToolOutput,
} from "../ipc/config";
import { pickFileToOpen, pickPathToSave } from "../ipc/dialog";
import { exportExternalTools, importExternalTools } from "../ipc/portable";
import { logger } from "../lib/logger";

interface ExternalToolsEditorProps {
  tools: readonly ExternalTool[];
  onChange: (next: ExternalTool[]) => void;
}

const NEW_TOOL: ExternalTool = {
  name: "",
  command: "",
  input: "selection",
  output: "replace",
  cwd: "fileDir",
  shortcut: null,
};

export function ExternalToolsEditor({
  tools,
  onChange,
}: ExternalToolsEditorProps) {
  const { t } = useTranslation();

  const patch = (index: number, next: Partial<ExternalTool>) =>
    onChange(
      tools.map((tool, at) => (at === index ? { ...tool, ...next } : tool)),
    );

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p
        className="m-0 text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("externalTool.hint")}
      </p>

      {tools.map((tool, index) => (
        <div
          key={index}
          className="flex flex-col gap-[var(--space-1)] border border-[var(--border-subtle)] p-[var(--space-2)]"
        >
          <div className="flex items-center gap-[var(--space-2)]">
            <span className="min-w-0 flex-1">
              <Input
                value={tool.name}
                placeholder={t("externalTool.namePlaceholder")}
                aria-label={t("externalTool.name")}
                onChange={(event) => patch(index, { name: event.target.value })}
              />
            </span>
            <IconButton
              icon="close"
              label={t("externalTool.remove")}
              onClick={() => onChange(tools.filter((_, at) => at !== index))}
            />
          </div>

          <Input
            mono
            value={tool.command}
            placeholder={t("externalTool.commandPlaceholder")}
            aria-label={t("externalTool.command")}
            onChange={(event) => patch(index, { command: event.target.value })}
          />

          <div className="flex flex-wrap gap-[var(--space-2)]">
            <Select
              aria-label={t("externalTool.input")}
              value={tool.input}
              onValueChange={(value) =>
                patch(index, { input: value as ExternalToolInput })
              }
              options={[
                {
                  value: "selection",
                  label: t("externalTool.input.selection"),
                },
                { value: "document", label: t("externalTool.input.document") },
                { value: "none", label: t("externalTool.input.none") },
              ]}
            />
            <Select
              aria-label={t("externalTool.output")}
              value={tool.output}
              onValueChange={(value) =>
                patch(index, { output: value as ExternalToolOutput })
              }
              options={[
                { value: "replace", label: t("externalTool.output.replace") },
                { value: "newTab", label: t("externalTool.output.newTab") },
                { value: "preview", label: t("externalTool.output.preview") },
                { value: "none", label: t("externalTool.output.none") },
              ]}
            />
            <Select
              aria-label={t("externalTool.cwd")}
              value={tool.cwd}
              onValueChange={(value) =>
                patch(index, { cwd: value as ExternalToolCwd })
              }
              options={[
                { value: "fileDir", label: t("externalTool.cwd.fileDir") },
                { value: "workspace", label: t("externalTool.cwd.workspace") },
              ]}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-[var(--space-2)]">
        <IconButton
          icon="add"
          label={t("externalTool.add")}
          onClick={() => onChange([...tools, { ...NEW_TOOL }])}
        />
        <IconButton
          icon="import"
          label={t("externalTool.import")}
          onClick={() => {
            void (async () => {
              const path = await pickFileToOpen();
              if (!path) return;
              try {
                // 导入是追加而不是覆盖：用户很少希望导一份就没掉现有的
                onChange([...tools, ...(await importExternalTools(path))]);
              } catch (error) {
                logger.warn("import external tools failed", error);
              }
            })();
          }}
        />
        <IconButton
          icon="export"
          label={t("externalTool.export")}
          disabled={tools.length === 0}
          onClick={() => {
            void (async () => {
              const path = await pickPathToSave();
              if (!path) return;
              try {
                await exportExternalTools(path, tools);
              } catch (error) {
                logger.warn("export external tools failed", error);
              }
            })();
          }}
        />
      </div>
    </div>
  );
}
