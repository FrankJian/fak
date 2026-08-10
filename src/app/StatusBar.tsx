/**
 * 状态栏（SPEC §5.4、F2.4）。
 *
 * 规矩：**不写字段名，只放图标 + 值**。「行数 1,234」里的「行数」两个字
 * 每次渲染都在重复同一件事，图标一次就说清了。语义靠 tooltip 与 aria-label 补偿。
 */
import { Icon } from "../design/Icon";
import { Tooltip } from "../design/components/Tooltip";
import { useTranslation } from "../i18n/useTranslation";
import type { IconName } from "../design/iconRegistry";
import type { DocumentMeta } from "../ipc/documents";
import type { SyncStatus } from "../ipc/editSync";
import { formatBytes, formatCount, formatLineEnding } from "../lib/format";
import { syntaxKeyFromFileName, type SyntaxKey } from "../lib/syntaxKey";
import type { EditorStatus } from "../editor/useEditorView";
import type { MessageKey } from "../i18n";
import type { RefObject } from "react";

function syntaxLabelKey(key: SyntaxKey): MessageKey {
  return `syntax.${key}` as MessageKey;
}

interface FieldProps {
  icon: IconName;
  label: string;
  value: string;
  /** 编码探测置信度低时给提示态（SPEC F1.2，中文用户自救的唯一入口） */
  warn?: boolean;
  onClick?: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

function Field({ icon, label, value, warn, onClick, buttonRef }: FieldProps) {
  const content = (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: warn ? "var(--warning)" : undefined }}
    >
      <Icon name={icon} variant="status" />
      {/* 数字用 tabular-nums，否则光标移动时整行会左右抖（SPEC §6.4） */}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );

  return (
    <Tooltip label={label} placement="top">
      {onClick ? (
        <button
          type="button"
          ref={buttonRef}
          aria-label={`${label}: ${value}`}
          onClick={onClick}
          className="inline-flex h-full items-center rounded-[var(--radius-control)] px-1.5 hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          {content}
        </button>
      ) : (
        <span
          aria-label={`${label}: ${value}`}
          className="inline-flex h-full items-center px-1.5"
        >
          {content}
        </span>
      )}
    </Tooltip>
  );
}

interface StatusBarProps {
  meta: DocumentMeta | null;
  syncStatus: SyncStatus;
  editorStatus?: EditorStatus | null;
  /** 当前文档上次备份完成的时刻（SPEC F1.6 步骤 8） */
  lastBackupAt?: number | null;
  /**
   * 会话恢复时打不开的文件数（SPEC F1.7 步骤 2）。启动时不该被对话框拦住，
   * 所以这条只在状态栏说一句，用户点一下就消失。
   */
  sessionMissing?: number;
  onDismissSessionMissing?: () => void;
  onEncodingClick?: () => void;
  onLineEndingClick?: () => void;
  encodingButtonRef?: RefObject<HTMLButtonElement | null>;
  lineEndingButtonRef?: RefObject<HTMLButtonElement | null>;
  onPromoteStream?: () => void;
}

export function StatusBar({
  meta,
  syncStatus,
  editorStatus,
  lastBackupAt,
  sessionMissing = 0,
  onDismissSessionMissing,
  onEncodingClick,
  onLineEndingClick,
  encodingButtonRef,
  lineEndingButtonRef,
  onPromoteStream,
}: StatusBarProps) {
  const { t, locale } = useTranslation();

  // 备份指示只在脏文档上出现：干净文档没有会丢的东西，摆个图标只是噪声
  const backupField = (() => {
    if (!meta?.dirty) return null;
    if (meta.mode === "stream") {
      return {
        value: t("status.backup.unsupported"),
        label: t("status.backup"),
      };
    }
    if (lastBackupAt === null || lastBackupAt === undefined) {
      return { value: t("status.backup.never"), label: t("status.backup") };
    }
    return {
      value: t("status.backup.saved"),
      label: `${t("status.backup")} · ${new Date(lastBackupAt).toLocaleTimeString(locale)}`,
    };
  })();

  const syntaxKey = meta ? syntaxKeyFromFileName(meta.fileName) : null;
  const syntaxValue = syntaxKey
    ? t(syntaxLabelKey(syntaxKey))
    : t("syntax.plainText");
  const modeHint =
    meta?.mode === "lean"
      ? t("status.mode.lean.hint")
      : meta?.mode === "stream"
        ? t("status.mode.stream.hint")
        : null;

  return (
    <footer
      className="flex shrink-0 items-center gap-1 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[var(--text-secondary)]"
      style={{
        height: "var(--h-statusbar)",
        fontSize: "var(--font-size-small)",
      }}
    >
      {sessionMissing > 0 && (
        <Field
          icon="warning"
          label={t("session.missing")}
          value={t("session.missing.count", {
            count: formatCount(sessionMissing),
          })}
          warn
          onClick={onDismissSessionMissing}
        />
      )}

      {meta ? (
        <>
          {editorStatus && meta.mode !== "stream" && (
            <>
              <Field
                icon="cursorPosition"
                label={t("status.cursor")}
                value={`${formatCount(editorStatus.line)}:${formatCount(editorStatus.column)}`}
              />
              {editorStatus.selectionChars > 0 && (
                <Field
                  icon="selectAll"
                  label={t("status.selection")}
                  value={formatCount(editorStatus.selectionChars)}
                />
              )}
            </>
          )}
          <Field
            icon="lineCount"
            label={t("status.lines")}
            value={formatCount(meta.lineCount)}
          />
          <Field
            icon="fileSize"
            label={t("status.size")}
            value={formatBytes(meta.sizeBytes)}
          />

          <span className="flex-1" />

          {/* 档位徽标只在降级时出现——Tier A 是常态，常态不需要提示 */}
          {meta.mode !== "full" && (
            <Field
              icon="largeFile"
              label={
                modeHint ??
                t(
                  meta.mode === "lean"
                    ? "status.mode.lean"
                    : "status.mode.stream",
                )
              }
              value={t(
                meta.mode === "lean"
                  ? "status.mode.lean"
                  : "status.mode.stream",
              )}
              onClick={meta.mode === "stream" ? onPromoteStream : undefined}
            />
          )}

          {backupField && (
            <Field
              icon="backup"
              label={backupField.label}
              value={backupField.value}
            />
          )}

          {syncStatus !== "idle" && (
            <Field
              icon="syncing"
              label={t("status.syncing")}
              value={t(
                syncStatus === "pending"
                  ? "status.sync.pending"
                  : "status.sync.resyncing",
              )}
            />
          )}

          <Field
            icon="encoding"
            label={t("status.encoding")}
            value={meta.encoding}
            warn={meta.encodingConfidence === "low"}
            onClick={onEncodingClick}
            buttonRef={encodingButtonRef}
          />
          <Field
            icon="lineEnding"
            label={t("status.lineEnding")}
            value={formatLineEnding(meta.lineEnding)}
            onClick={onLineEndingClick}
            buttonRef={lineEndingButtonRef}
          />
          <Field icon="syntax" label={t("status.syntax")} value={syntaxValue} />
        </>
      ) : (
        <span className="px-1.5">{t("app.ready")}</span>
      )}
    </footer>
  );
}
