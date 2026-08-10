/**
 * 跨文件替换确认（SPEC F4.6、P4-02）。
 *
 * 这是全应用唯一会批量改磁盘文件的入口，所以默认不勾选任何危险简化：
 * 每个文件、每一处都能单独取消，落盘前把「将修改 N 个文件的 M 处」摆在最显眼处，
 * 并明确写出**不可撤销**。
 */
import { useMemo, useState } from "react";
import { Icon } from "../design/Icon";
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";
import type {
  PathReplacePreview,
  PathReplaceReport,
  SelectedReplaceFile,
} from "../ipc/pathReplace";

interface ConfirmPathReplaceDialogProps {
  preview: PathReplacePreview | null;
  report: PathReplaceReport | null;
  applying: boolean;
  /** 已在编辑器里打开且为脏的文件（相对路径）。这些只改内存，不写盘 */
  dirtyPaths: ReadonlySet<string>;
  onConfirm: (selected: SelectedReplaceFile[]) => void;
  onClose: () => void;
}

function key(path: string, index: number): string {
  return `${path}\u0000${index}`;
}

export function ConfirmPathReplaceDialog({
  preview,
  report,
  applying,
  dirtyPaths,
  onConfirm,
  onClose,
}: ConfirmPathReplaceDialogProps) {
  const { t } = useTranslation();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const selected = useMemo<SelectedReplaceFile[]>(() => {
    if (!preview) return [];
    return preview.files
      .map((file) => ({
        path: file.path,
        replacementIndexes: file.replacements
          .map((item) => item.index)
          .filter((index) => !excluded.has(key(file.path, index))),
      }))
      .filter((file) => file.replacementIndexes.length > 0);
  }, [preview, excluded]);

  const counts = useMemo(
    () => ({
      files: selected.length,
      replacements: selected.reduce(
        (sum, file) => sum + file.replacementIndexes.length,
        0,
      ),
    }),
    [selected],
  );

  const toggle = (path: string, index: number) =>
    setExcluded((current) => {
      const next = new Set(current);
      const id = key(path, index);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleFile = (path: string, indexes: readonly number[]) =>
    setExcluded((current) => {
      const next = new Set(current);
      const allExcluded = indexes.every((index) => next.has(key(path, index)));
      for (const index of indexes) {
        if (allExcluded) next.delete(key(path, index));
        else next.add(key(path, index));
      }
      return next;
    });

  if (report) {
    return (
      <Modal
        open
        title={t("find.replaceReportTitle")}
        onClose={onClose}
        footer={
          <Button variant="strong" onClick={onClose}>
            {t("dialog.close")}
          </Button>
        }
      >
        <div
          className="flex flex-col gap-[var(--space-2)] text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <p className="tabular-nums">
            {t("find.replaceReport", {
              files: report.changedFiles,
              replacements: report.changedReplacements,
            })}
          </p>
          {report.skipped.length > 0 && (
            <div className="flex flex-col gap-[2px] text-[var(--text-secondary)]">
              <span>{t("find.replaceSkippedTitle")}</span>
              {report.skipped.map((item) => (
                <span
                  key={`${item.pathHint}-${item.reason}`}
                  className="truncate"
                >
                  {item.pathHint} · {t(`find.skip.${item.reason}`)}
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  if (!preview) return null;

  return (
    <Modal
      open
      title={t("find.replacePreviewTitle")}
      onClose={onClose}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={applying}>
            {t("dialog.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={applying || counts.replacements === 0}
            onClick={() => onConfirm(selected)}
          >
            {t("find.replaceApply")}
          </Button>
        </>
      }
    >
      <div
        className="flex max-h-[60vh] min-h-0 flex-col gap-[var(--space-2)] text-[var(--text-primary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        <p className="tabular-nums">
          {t("find.replacePreviewCount", {
            files: counts.files,
            replacements: counts.replacements,
          })}
        </p>
        <p style={{ color: "var(--danger)" }}>
          {t("find.replaceIrreversible")}
        </p>

        <div className="min-h-0 flex-1 overflow-auto border border-[var(--border-subtle)]">
          {preview.files.map((file) => {
            const indexes = file.replacements.map((item) => item.index);
            const fileExcluded = indexes.every((index) =>
              excluded.has(key(file.path, index)),
            );
            return (
              <div key={file.path}>
                <label className="flex items-center gap-[var(--space-2)] bg-[var(--bg-surface)] px-[var(--space-2)] py-[2px]">
                  <input
                    type="checkbox"
                    checked={!fileExcluded}
                    onChange={() => toggleFile(file.path, indexes)}
                  />
                  <Icon name="file" variant="status" />
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                  {dirtyPaths.has(file.path) && (
                    <span className="shrink-0 text-[var(--text-secondary)]">
                      {t("find.replaceDirtyInMemory")}
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-[var(--text-tertiary)]">
                    {indexes.length}
                  </span>
                </label>
                {file.replacements.map((item) => (
                  <label
                    key={item.index}
                    className="flex items-start gap-[var(--space-2)] px-[var(--space-4)] py-[1px]"
                  >
                    <input
                      type="checkbox"
                      checked={!excluded.has(key(file.path, item.index))}
                      onChange={() => toggle(file.path, item.index)}
                    />
                    <span className="w-[52px] shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">
                      {item.line + 1}
                    </span>
                    <span className="min-w-0 flex-1 font-mono">
                      <span className="block truncate text-[var(--text-secondary)] line-through">
                        {item.before}
                      </span>
                      <span className="block truncate">{item.after}</span>
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
