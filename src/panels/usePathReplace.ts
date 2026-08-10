/**
 * 跨文件替换的状态机（SPEC F4.6、P4-02）。
 *
 * 两阶段：先要一份完整预览，用户逐处确认后才落盘。预览会话在 Rust 侧单次消费，
 * 所以这里不缓存旧预览，换查询就重新预览。
 *
 * **已在编辑器里打开且为脏的文件不写盘**（步骤 3 最后一条）：磁盘上的内容不是
 * 用户正在看的内容，覆盖它等于悄悄丢掉未保存的编辑。这类文件从落盘选择里剔除，
 * 改为报告给调用方走内存替换。
 */
import { useCallback, useState } from "react";
import { describeError, isSilent } from "../ipc/errors";
import {
  applyPathReplace,
  previewPathReplace,
  type PathReplacePreview,
  type PathReplaceReport,
  type SelectedReplaceFile,
} from "../ipc/pathReplace";
import type { PathSearchRequest } from "../ipc/pathSearch";
import { useAppStore } from "../store/appStore";

interface UsePathReplaceOptions {
  /** 相对路径 → 已打开且为脏。这些文件走内存分支 */
  dirtyPaths: ReadonlySet<string>;
  /** 内存分支的执行者；返回实际改动的处数 */
  onReplaceInMemory: (paths: readonly string[]) => Promise<number>;
}

export function usePathReplace({
  dirtyPaths,
  onReplaceInMemory,
}: UsePathReplaceOptions) {
  const language = useAppStore((store) => store.language);
  const [preview, setPreview] = useState<PathReplacePreview | null>(null);
  const [report, setReport] = useState<PathReplaceReport | null>(null);
  const [applying, setApplying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const report_ = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setProblem(`${presentation.title} · ${presentation.next}`);
    },
    [language],
  );

  const start = useCallback(
    async (request: PathSearchRequest & { replacement: string }) => {
      setProblem(null);
      setReport(null);
      try {
        setPreview(await previewPathReplace(request));
      } catch (error) {
        report_(error);
      }
    },
    [report_],
  );

  const confirm = useCallback(
    async (selected: SelectedReplaceFile[]) => {
      if (!preview) return;
      setApplying(true);
      try {
        const onDisk = selected.filter((file) => !dirtyPaths.has(file.path));
        const inMemory = selected.filter((file) => dirtyPaths.has(file.path));
        const result = await applyPathReplace(preview.sessionId, onDisk);
        const memoryCount =
          inMemory.length > 0
            ? await onReplaceInMemory(inMemory.map((file) => file.path))
            : 0;
        setPreview(null);
        setReport({
          ...result,
          changedFiles: result.changedFiles + inMemory.length,
          changedReplacements: result.changedReplacements + memoryCount,
        });
      } catch (error) {
        report_(error);
      } finally {
        setApplying(false);
      }
    },
    [preview, dirtyPaths, onReplaceInMemory, report_],
  );

  return {
    preview,
    report,
    applying,
    problem,
    start,
    confirm,
    close: () => {
      setPreview(null);
      setReport(null);
    },
  };
}
