/**
 * 渲染兜底（SPEC §6.7「解释而不是沉默」）。
 *
 * React 18 在未捕获的渲染错误上会卸载整棵树——表现就是**整窗白屏**，
 * 既没有提示也没有日志，用户与开发者都无从下手。这一层把它变成一条
 * 能读、能上报、能恢复的错误。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "../i18n/useTranslation";
import { logger } from "../lib/logger";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

function CrashPanel({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] bg-[var(--bg-base)] px-[var(--space-4)] text-[var(--text-primary)]"
    >
      <span style={{ color: "var(--danger)" }}>{t("crash.title")}</span>
      <span
        className="max-w-[60ch] break-words text-center text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {message}
      </span>
      <span
        className="text-[var(--text-tertiary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("crash.next")}
      </span>
      <button
        type="button"
        onClick={onReset}
        className="border border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-1)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("crash.retry")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 组件栈只有组件名，不含用户数据与绝对路径，可以进日志（AGENTS.md §9.2）
    logger.error(`ui crashed${info.componentStack ?? ""}`, error);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <CrashPanel
        message={this.state.message}
        onReset={() => this.setState({ message: null })}
      />
    );
  }
}
