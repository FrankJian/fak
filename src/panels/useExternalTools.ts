/**
 * 外部工具的执行层（SPEC F15）。
 *
 * 安全的部分全在 Rust（不经 shell、不继承环境、10 s 超时）；这里只负责三件事：
 *   1. **首次执行必须确认**——后端会拒绝未确认的调用，这里把那条拒绝变成对话框；
 *   2. 取正文/选区作为 stdin 之前先过同步闸门，否则 Rust 看到的是旧正文；
 *   3. 按 `output` 把 stdout 交付出去：替换选区、开新标签、或只做预览。
 */
import { useCallback, useState } from "react";
import type { EditorHandle } from "../editor/useEditorView";
import type { ExternalTool } from "../ipc/config";
import { IpcError } from "../ipc/invoke";
import { runExternalTool, runExternalToolStreamed } from "../ipc/externalTools";
import { describeError, isSilent } from "../ipc/errors";
import { useAppStore } from "../store/appStore";

export interface PendingConfirmation {
  tool: ExternalTool;
  command: string;
}

interface UseExternalToolsOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  workspaceRoot: string | null;
  /** `newTab` 输出：把结果放进一个新文档 */
  onNewTab: (text: string) => void;
  /** `preview` 输出：只展示，不动文档 */
  onPreview: (tool: ExternalTool, text: string) => void;
}

export function useExternalTools({
  documentId,
  handleRef,
  workspaceRoot,
  onNewTab,
  onPreview,
}: UseExternalToolsOptions) {
  const language = useAppStore((store) => store.language);
  const confirmedTools = useAppStore((store) => store.externalToolsConfirmed);
  const patchConfig = useAppStore((store) => store.patchConfig);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setProblem(`${presentation.title} · ${presentation.next}`);
    },
    [language],
  );

  const execute = useCallback(
    async (tool: ExternalTool, confirmedForThisRun: boolean) => {
      setRunning(tool.name);
      setProblem(null);
      try {
        const handle = handleRef.current;
        // 以 Rust 为准的操作前必须 flush（SPEC P1 契约第 4 条）
        await handle?.flush();
        const selection = handle?.getSelection();
        const request = {
          toolName: tool.name,
          documentId: documentId ?? undefined,
          selection:
            tool.input === "selection" &&
            selection &&
            selection.from !== selection.to
              ? handle?.getText().slice(selection.from, selection.to)
              : undefined,
          workspaceRoot: workspaceRoot ?? undefined,
          confirmedForThisRun,
        };

        let result;
        try {
          result = await runExternalTool(request);
        } catch (error) {
          // 输出装不进一次响应时改走分片通道，而不是把这次执行判死
          if (
            error instanceof IpcError &&
            error.payload.code === "resultTooLarge"
          ) {
            result = await runExternalToolStreamed(request);
          } else {
            throw error;
          }
        }

        if (result.output === "replace") {
          const range = handle?.getSelection();
          if (range && range.from !== range.to) {
            handle?.applyReplacements([
              { start: range.from, end: range.to, insert: result.stdout },
            ]);
          } else {
            handle?.applyReplacements([
              {
                start: 0,
                end: handle.getText().length,
                insert: result.stdout,
              },
            ]);
          }
        } else if (result.output === "newTab") {
          onNewTab(result.stdout);
        } else if (result.output === "preview") {
          onPreview(tool, result.stdout);
        }
      } catch (error) {
        // 后端用这个错误强制「首次必须确认」，它不是失败而是一次询问
        if (
          error instanceof IpcError &&
          error.payload.code === "externalToolConfirmationRequired"
        ) {
          setPending({
            tool,
            command: String(
              (error.payload as { command?: string }).command ?? tool.command,
            ),
          });
          return;
        }
        report(error);
      } finally {
        setRunning(null);
      }
    },
    [documentId, handleRef, workspaceRoot, onNewTab, onPreview, report],
  );

  const run = useCallback(
    (tool: ExternalTool) => void execute(tool, false),
    [execute],
  );

  const confirm = useCallback(
    (remember: boolean) => {
      const target = pending;
      setPending(null);
      if (!target) return;
      if (remember && !confirmedTools.includes(target.tool.name)) {
        void patchConfig({
          externalToolsConfirmed: [...confirmedTools, target.tool.name],
        });
      }
      void execute(target.tool, true);
    },
    [pending, confirmedTools, patchConfig, execute],
  );

  return {
    pending,
    running,
    problem,
    run,
    confirm,
    cancelConfirm: () => setPending(null),
    dismissProblem: () => setProblem(null),
  };
}
