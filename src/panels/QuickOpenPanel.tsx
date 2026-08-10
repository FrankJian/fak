/**
 * 快速打开（SPEC F13 `Ctrl+P` / P2-06 步骤 2）。
 *
 * 候选目前只有「已打开的标签 + 最近打开过的文件」。工作区全量索引要等
 * 文件树（P2-01）落地——那之前把这条路开出来仍然划算：在几个已开文件之间
 * 用键盘来回切，本身就是 Ctrl+P 最常见的用法。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  onWorkspaceIndexProgress,
  workspaceIndexDispose,
  workspaceIndexQuery,
  workspaceIndexStart,
  type WorkspaceIndexMatch,
} from "../ipc/workspace";
import { useTranslation } from "../i18n/useTranslation";
import { buildQuickOpenEntries, rankQuickOpen } from "../lib/quickOpen";
import { QuickInput, type QuickInputItem } from "./QuickInput";

export interface QuickOpenTab {
  documentId: string;
  fileName: string;
  path: string | null;
}

interface QuickOpenPanelProps {
  tabs: readonly QuickOpenTab[];
  recentFiles: readonly string[];
  workspaceRoot: string | null;
  /** 已打开的走激活，未打开的走开文件 */
  onActivate: (documentId: string) => void;
  onOpenPath: (path: string) => void;
  onGoToLine: (initialQuery: string) => void;
  onClose: () => void;
}

export function QuickOpenPanel({
  tabs,
  recentFiles,
  workspaceRoot,
  onActivate,
  onOpenPath,
  onGoToLine,
  onClose,
}: QuickOpenPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState<WorkspaceIndexMatch[]>([]);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceRoot) return;
    let disposed = false;
    let pollingTimer: ReturnType<typeof setTimeout> | null = null;
    const stopProgress = onWorkspaceIndexProgress((progress) => {
      if (progress.sessionId !== sessionRef.current) return;
      if (progress.ready) setIndexReady(true);
    });
    const pollUntilReady = (nextSessionId: string) => {
      pollingTimer = setTimeout(() => {
        void workspaceIndexQuery(nextSessionId, "").then((page) => {
          if (disposed || sessionRef.current !== nextSessionId) return;
          if (page.ready) setIndexReady(true);
          else pollUntilReady(nextSessionId);
        });
      }, 250);
    };

    sessionRef.current = null;
    void workspaceIndexStart(workspaceRoot)
      .then((started) => {
        if (disposed) {
          void workspaceIndexDispose(started.sessionId);
          return;
        }
        sessionRef.current = started.sessionId;
        setIndexReady(false);
        setIndexedFiles([]);
        setSessionId(started.sessionId);
        pollUntilReady(started.sessionId);
      })
      .catch(() => {
        if (!disposed) setIndexReady(true);
      });

    return () => {
      disposed = true;
      stopProgress();
      if (pollingTimer) clearTimeout(pollingTimer);
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) void workspaceIndexDispose(current);
    };
  }, [workspaceRoot]);

  useEffect(() => {
    if (!sessionId || !indexReady) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void workspaceIndexQuery(sessionId, query).then((page) => {
        if (!disposed && sessionRef.current === sessionId && page.ready)
          setIndexedFiles(page.matches);
      });
    }, 80);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [indexReady, query, sessionId]);

  const workspaceFiles = useMemo(
    () =>
      workspaceRoot
        ? indexedFiles.map((file) => ({
            path: joinWorkspacePath(workspaceRoot, file.relativePath),
            fileName: file.fileName,
            pinyinInitials: file.pinyinInitials,
          }))
        : [],
    [indexedFiles, workspaceRoot],
  );
  const entries = useMemo(
    () => buildQuickOpenEntries(tabs, recentFiles, workspaceFiles),
    [recentFiles, tabs, workspaceFiles],
  );
  const results = useMemo(
    () => rankQuickOpen(entries, query),
    [entries, query],
  );

  const items: QuickInputItem[] = results.map((hit) => ({
    id: hit.entry.id,
    label: hit.entry.fileName,
    // 只显示目录部分：文件名已经在左边了，整条路径重复一遍会把窄面板挤爆
    detail: directoryOf(hit.entry.path),
  }));

  const commit = (index: number) => {
    const hit = results[index];
    if (!hit) return;
    onClose();
    if (hit.entry.documentId) onActivate(hit.entry.documentId);
    else onOpenPath(hit.entry.path);
  };

  return (
    <QuickInput
      icon="quickOpen"
      placeholder={t("quickOpen.placeholder")}
      emptyLabel={
        workspaceRoot && !indexReady
          ? t("quickOpen.indexing")
          : t("quickOpen.empty")
      }
      query={query}
      onQueryChange={(next) => {
        if (next.startsWith(":")) {
          onGoToLine(next);
          return;
        }
        setQuery(next);
        setHighlighted(0);
      }}
      items={items}
      highlighted={highlighted}
      onHighlight={setHighlighted}
      onCommit={commit}
      onClose={onClose}
    />
  );
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return root.endsWith(separator)
    ? `${root}${relativePath}`
    : `${root}${separator}${relativePath}`;
}

function directoryOf(path: string): string | undefined {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : undefined;
}
