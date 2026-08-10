/** Tier C 的“替换后另存”流程：先完整预览，再选择新路径原子写入。 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "../design/components/Button";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { Modal } from "../design/components/Modal";
import { SegmentedControl } from "../design/components/SegmentedControl";
import { useTranslation } from "../i18n/useTranslation";
import { pickPathToSave } from "../ipc/dialog";
import { describeError, isSilent } from "../ipc/errors";
import type { MatchMode, SearchOptions } from "../ipc/search";
import {
  applyStreamReplace,
  cancelStreamTransform,
  previewStreamReplace,
  type StreamProgress,
  type StreamReplacePreview,
  type StreamTransformReport,
} from "../ipc/streamTransform";
import { formatBytes } from "../lib/format";
import { useAppStore } from "../store/appStore";

interface StreamReplaceDialogProps {
  documentId: string;
  initialQuery: string;
  initialOptions: SearchOptions;
  onClose: () => void;
}

export function StreamReplaceDialog({
  documentId,
  initialQuery,
  initialOptions,
  onClose,
}: StreamReplaceDialogProps) {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState(initialOptions);
  const [preserveCase, setPreserveCase] = useState(false);
  const [preview, setPreview] = useState<StreamReplacePreview | null>(null);
  const [completed, setCompleted] = useState<StreamTransformReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(
    () => () => {
      void cancelStreamTransform(documentId);
    },
    [documentId],
  );

  const noteProgress = useCallback(({ processedLines, totalLines }: StreamProgress) => {
    setProgress(totalLines === 0 ? 0 : Math.min(1, processedLines / totalLines));
  }, []);

  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const detail = describeError(error, language);
      setProblem(`${detail.title} · ${detail.next}`);
    },
    [language],
  );

  const invalidate = () => {
    setPreview(null);
    setCompleted(null);
    setProblem(null);
  };

  const runPreview = async () => {
    setRunning(true);
    setProgress(0);
    setProblem(null);
    setCompleted(null);
    try {
      const result = await previewStreamReplace(
        documentId,
        query,
        replacement,
        options,
        preserveCase,
        noteProgress,
      );
      setPreview(result);
      setProgress(1);
    } catch (error) {
      report(error);
    } finally {
      setRunning(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const path = await pickPathToSave();
    if (!path) return;
    setRunning(true);
    setProgress(0);
    setProblem(null);
    try {
      const result = await applyStreamReplace(preview.previewId, path, noteProgress);
      setCompleted(result);
      setProgress(1);
    } catch (error) {
      report(error);
    } finally {
      setRunning(false);
    }
  };

  const modes: ReadonlyArray<{ value: MatchMode; label: string }> = [
    { value: "literal", label: t("find.mode.literal") },
    { value: "regex", label: t("find.mode.regex") },
    { value: "wildcard", label: t("find.mode.wildcard") },
  ];

  return (
    <Modal
      open
      title={t("stream.replace.title")}
      widthPx={680}
      closeOnScrimClick={!running}
      onClose={running ? () => undefined : onClose}
      footer={
        <>
          <Button
            onClick={() =>
              running ? void cancelStreamTransform(documentId) : onClose()
            }
          >
            {t(running ? "stream.replace.cancel" : "dialog.close")}
          </Button>
          {!completed && preview === null && (
            <Button
              variant="strong"
              disabled={running || query.length === 0}
              onClick={() => void runPreview()}
            >
              {t("stream.replace.preview")}
            </Button>
          )}
          {!completed && preview !== null && (
            <Button
              variant="strong"
              disabled={running || preview.replacementCount === 0}
              onClick={() => void apply()}
            >
              {t("stream.replace.saveCopy")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        <p className="m-0 text-[var(--text-secondary)]">
          {t("stream.replace.readOnlySource")}
        </p>
        <SegmentedControl
          value={options.mode}
          options={modes}
          label={t("find.mode")}
          onValueChange={(mode) => {
            invalidate();
            setOptions((current) => ({ ...current, mode, multiline: false }));
          }}
        />
        <div className="flex items-center gap-[var(--space-2)]">
          <span className="min-w-0 flex-1">
            <Input
              autoFocus
              mono
              leadingIcon="find"
              value={query}
              placeholder={t("find.queryPlaceholder")}
              aria-label={t("find.query")}
              onChange={(event) => {
                invalidate();
                setQuery(event.target.value);
              }}
            />
          </span>
          <IconButton
            icon="matchCase"
            label={t("find.caseSensitive")}
            active={options.caseSensitive}
            onClick={() => {
              invalidate();
              setOptions((current) => ({
                ...current,
                caseSensitive: !current.caseSensitive,
              }));
            }}
          />
          <IconButton
            icon="matchWholeWord"
            label={t("find.wholeWord")}
            active={options.wholeWord}
            onClick={() => {
              invalidate();
              setOptions((current) => ({
                ...current,
                wholeWord: !current.wholeWord,
              }));
            }}
          />
        </div>
        <Input
          mono
          leadingIcon="replace"
          value={replacement}
          placeholder={t("find.replacementPlaceholder")}
          aria-label={t("find.replacement")}
          onChange={(event) => {
            invalidate();
            setReplacement(event.target.value);
          }}
        />
        <div className="flex flex-wrap gap-[var(--space-4)] text-[var(--text-secondary)]">
          <label className="flex items-center gap-[var(--space-2)]">
            <input
              type="checkbox"
              checked={options.parseEscapes}
              onChange={() => {
                invalidate();
                setOptions((current) => ({
                  ...current,
                  parseEscapes: !current.parseEscapes,
                }));
              }}
            />
            {t("find.parseEscapes")}
          </label>
          <label className="flex items-center gap-[var(--space-2)]">
            <input
              type="checkbox"
              disabled={options.mode !== "literal"}
              checked={preserveCase && options.mode === "literal"}
              onChange={() => {
                invalidate();
                setPreserveCase((current) => !current);
              }}
            />
            {t("find.preserveCase")}
          </label>
        </div>

        {running && (
          <div
            aria-label={t("stream.replace.progress")}
            className="h-[2px] overflow-hidden bg-[var(--bg-active)]"
          >
            <div
              className="h-full bg-[var(--accent)]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
        {problem && <p role="alert" className="m-0 text-[var(--danger)]">{problem}</p>}
        {preview && !completed && (
          <div className="flex flex-col gap-[var(--space-2)]">
            <p className="m-0 text-[var(--text-primary)]">
              {t("stream.replace.summary", {
                count: preview.replacementCount.toLocaleString(),
                size: formatBytes(preview.outputBytes),
              })}
            </p>
            <div className="max-h-[220px] overflow-auto border border-[var(--border-subtle)]">
              {preview.samples.map((sample) => (
                <div
                  key={sample.line}
                  className="border-b border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)] font-mono"
                  style={{ fontSize: "var(--font-size-small)" }}
                >
                  <span className="tabular-nums text-[var(--text-tertiary)]">
                    {sample.line + 1}
                  </span>
                  <div className="truncate text-[var(--text-secondary)]">− {sample.before}</div>
                  <div className="truncate text-[var(--text-primary)]">+ {sample.after}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {completed && (
          <p role="status" className="m-0 text-[var(--text-primary)]">
            {t("stream.replace.complete", {
              count: completed.affectedLines.toLocaleString(),
              size: formatBytes(completed.bytesWritten),
            })}
          </p>
        )}
      </div>
    </Modal>
  );
}
