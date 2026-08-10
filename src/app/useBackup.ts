/**
 * 备份调度与崩溃恢复接线（SPEC F1.6）。
 *
 * 触发时机的规则在 `lib/backupSchedule.ts`（纯函数、可测），
 * 这里只负责把它接到真实的时钟、窗口事件与 IPC 上。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  backupDocument,
  discardAllBackups,
  discardBackup,
  markCleanExit,
  pendingBackups,
  recoverBackup,
  type BackupMeta,
} from '../ipc/backup';
import type { DocumentMeta } from '../ipc/documents';
import {
  dueTrigger,
  hasUnbackedEdits,
  idleClock,
  noteBackup,
  noteEdit,
  type BackupClock,
} from '../lib/backupSchedule';
import { logger } from '../lib/logger';

/** 轮询步长。备份判定是纯内存比较，500 ms 一次的开销可以忽略。 */
const TICK_MS = 500;

export interface BackupController {
  /** 上次崩溃留下、等待用户处理的备份 */
  pending: BackupMeta[];
  /** 当前活动文档上次备份完成的时刻；null 表示还没备份过 */
  lastBackupAt: number | null;
  noteEdit: () => void;
  recoverOne: (documentId: string) => Promise<void>;
  recoverAll: () => Promise<void>;
  discardOne: (documentId: string) => Promise<void>;
  discardAll: () => Promise<void>;
}

interface UseBackupOptions {
  activeDocumentId: string | null;
  /** 恢复出来的文档要挂进工作区；返回后提示条才移除该项 */
  onRecovered: (meta: DocumentMeta) => Promise<void>;
}

export function useBackup({ activeDocumentId, onRecovered }: UseBackupOptions): BackupController {
  const [pending, setPending] = useState<BackupMeta[]>([]);
  /**
   * 按文档记备份时刻。做成 map 而不是「当前文档一个值 + 切换时重置」，
   * 是因为后者要在切换的 effect 里 setState，那会引发级联渲染。
   */
  const [backupTimes, setBackupTimes] = useState<Record<string, number>>({});
  const clocksRef = useRef<Map<string, BackupClock>>(new Map());
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeDocumentId;
  }, [activeDocumentId]);

  const clockOf = (documentId: string) => clocksRef.current.get(documentId) ?? idleClock;

  const runBackup = useCallback(async (documentId: string) => {
    try {
      const outcome = await backupDocument(documentId);
      const at = outcome.savedAtMs ?? Date.now();
      // 跳过的也要推进时钟，否则不脏的文档会被每个 tick 重试一遍
      clocksRef.current.set(documentId, noteBackup(at));
      if (outcome.written) {
        setBackupTimes((current) => ({ ...current, [documentId]: at }));
      }
    } catch (error) {
      // 备份失败不该打断用户，但必须留下痕迹
      logger.warn('backup failed', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    pendingBackups()
      .then((scan) => {
        if (!cancelled) setPending(scan.pending);
      })
      .catch((error: unknown) => logger.warn('failed to scan backups', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const documentId = activeIdRef.current;
      if (!documentId) return;
      if (dueTrigger(Date.now(), clockOf(documentId)) === null) return;
      void runBackup(documentId);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [runBackup]);

  useEffect(() => {
    const onBlur = () => {
      const documentId = activeIdRef.current;
      if (!documentId) return;
      if (!hasUnbackedEdits(clockOf(documentId))) return;
      void runBackup(documentId);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [runBackup]);

  // 切换文档：先把要离开的那个备下来（F1.6 步骤 1）
  const previousIdRef = useRef<string | null>(null);
  useEffect(() => {
    const leaving = previousIdRef.current;
    previousIdRef.current = activeDocumentId;
    if (!leaving || leaving === activeDocumentId) return;
    if (!hasUnbackedEdits(clockOf(leaving))) return;
    void runBackup(leaving);
  }, [activeDocumentId, runBackup]);

  const recoverOne = useCallback(
    async (documentId: string) => {
      try {
        const recovered = await recoverBackup(documentId);
        await onRecovered(recovered.meta);
        // 恢复出来的正文此刻只在内存里，备份要留到用户保存为止（F1.6 步骤 7），
        // 所以这里只从提示条里摘掉，不调 discard
        setPending((current) => current.filter((meta) => meta.documentId !== documentId));
      } catch (error) {
        logger.warn('recover failed', error);
      }
    },
    [onRecovered],
  );

  const recoverAll = useCallback(async () => {
    // 顺序恢复：并发会让多个文档同时抢活动标签，最后停在哪个不确定
    for (const meta of [...pending]) {
      await recoverOne(meta.documentId);
    }
  }, [pending, recoverOne]);

  const discardOne = useCallback(async (documentId: string) => {
    try {
      await discardBackup(documentId);
      setPending((current) => current.filter((meta) => meta.documentId !== documentId));
    } catch (error) {
      logger.warn('discard failed', error);
    }
  }, []);

  const discardAll = useCallback(async () => {
    try {
      await discardAllBackups();
      setPending([]);
    } catch (error) {
      logger.warn('discard all failed', error);
    }
  }, []);

  return {
    pending,
    lastBackupAt: activeDocumentId ? (backupTimes[activeDocumentId] ?? null) : null,
    noteEdit: () => {
      const documentId = activeIdRef.current;
      if (!documentId) return;
      clocksRef.current.set(documentId, noteEdit(clockOf(documentId), Date.now()));
    },
    recoverOne,
    recoverAll,
    discardOne,
    discardAll,
  };
}

export { markCleanExit };
