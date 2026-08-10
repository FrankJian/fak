/**
 * 文本工具的动作层（SPEC F3.3 右键菜单、F9.2）。
 *
 * 三条纪律都在这里，组件里一条都不用重复：
 * 1. 以 Rust 为准的操作前必须 flush 编辑同步队列（SPEC P1 契约第 4 条）；
 * 2. 文本转换有选区就作用于选区；「格式化文档」按名称与 SPEC F9 始终作用于全文；
 * 3. 结果作为**一次编辑批次**落下去，从而整次操作是单个撤销步骤。
 */
import { useCallback } from "react";
import type { EditorHandle } from "../editor/useEditorView";
import { copyToClipboard } from "../ipc/clipboard";
import {
  formatSyntaxOf,
  planBase64,
  planFormat,
  planIndentTool,
  planLineTool,
  transcodeBase64,
  type Base64Direction,
  type FormatSyntax,
  type IndentTool,
  type LineTool,
  type Selection,
} from "../ipc/textops";

interface UseTextToolsOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  onError: (error: unknown) => void;
  /** 来自配置的缩进设定（SPEC §9.2），格式化与制表符转换都要用 */
  tabWidth: number;
  useTabs: boolean;
  /** 当前文件名，用于判定格式化语法 */
  fileName: string | null;
}

export interface TextToolActions {
  runLineTool: (tool: LineTool) => void;
  /** 编解码并替换选区 */
  runBase64: (direction: Base64Direction) => void;
  /** 只把结果放进剪贴板，文档不动 */
  copyBase64: (direction: Base64Direction) => void;
  /** 格式化 / 压缩（SPEC F9.1） */
  runFormat: (syntax: FormatSyntax, minify: boolean) => void;
  runIndentTool: (tool: IndentTool) => void;
  /** 当前文件对应的格式化语法；null 时格式化入口应禁用 */
  formatSyntax: () => FormatSyntax | null;
}

export function useTextTools({
  documentId,
  handleRef,
  onError,
  tabWidth,
  useTabs,
  fileName,
}: UseTextToolsOptions): TextToolActions {
  /**
   * 备好一次调用要的两样东西：文档 ID 与选区。
   *
   * 返回 `null` 表示没有可操作的文档，调用方直接放弃。
   */
  const prepare = useCallback(async (includeSelection = true): Promise<{
    documentId: string;
    selection: Selection | undefined;
  } | null> => {
    if (!documentId) return null;
    const handle = handleRef.current;
    // 队列里还压着的编辑不 flush，Rust 看到的就是旧正文，
    // 算出来的改动坐标会落在错的位置上（SPEC P1 契约第 4 条）
    await handle?.flush();
    const selection = includeSelection ? handle?.getSelection() : undefined;
    return {
      documentId,
      selection:
        selection && selection.from !== selection.to ? selection : undefined,
    };
    // handleRef 由 App 创建一次，始终是同一个对象
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const runLineTool = useCallback(
    (tool: LineTool) => {
      void (async () => {
        const context = await prepare();
        if (!context) return;
        try {
          const edits = await planLineTool(
            context.documentId,
            tool,
            context.selection,
          );
          if (edits.length > 0) handleRef.current?.applyReplacements(edits);
        } catch (error) {
          onError(error);
        }
      })();
    },
    [prepare, handleRef, onError],
  );

  const runBase64 = useCallback(
    (direction: Base64Direction) => {
      void (async () => {
        const context = await prepare();
        if (!context) return;
        try {
          const edits = await planBase64(
            context.documentId,
            direction,
            context.selection,
          );
          if (edits.length > 0) handleRef.current?.applyReplacements(edits);
        } catch (error) {
          onError(error);
        }
      })();
    },
    [prepare, handleRef, onError],
  );

  const copyBase64 = useCallback(
    (direction: Base64Direction) => {
      void (async () => {
        const context = await prepare();
        if (!context) return;
        try {
          await copyToClipboard(
            await transcodeBase64(
              context.documentId,
              direction,
              context.selection,
            ),
          );
        } catch (error) {
          onError(error);
        }
      })();
    },
    [prepare, onError],
  );

  const runFormat = useCallback(
    (syntax: FormatSyntax, minify: boolean) => {
      void (async () => {
        const context = await prepare(false);
        if (!context) return;
        try {
          const edits = await planFormat(
            context.documentId,
            syntax,
            { minify, indentWidth: tabWidth, useTabs },
          );
          if (edits.length > 0) handleRef.current?.applyReplacements(edits);
        } catch (error) {
          onError(error);
        }
      })();
    },
    [prepare, handleRef, onError, tabWidth, useTabs],
  );

  const runIndentTool = useCallback(
    (tool: IndentTool) => {
      void (async () => {
        const context = await prepare();
        if (!context) return;
        try {
          const edits = await planIndentTool(
            context.documentId,
            tool,
            tabWidth,
            context.selection,
          );
          if (edits.length > 0) handleRef.current?.applyReplacements(edits);
        } catch (error) {
          onError(error);
        }
      })();
    },
    [prepare, handleRef, onError, tabWidth],
  );

  return {
    runLineTool,
    runBase64,
    copyBase64,
    runFormat,
    runIndentTool,
    formatSyntax: () => formatSyntaxOf(fileName),
  };
}
