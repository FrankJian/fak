/**
 * 更新流程的状态机（SPEC §12.3.3）。
 *
 * 自动检查与关于页的手动检查共用这一个状态机——两条路各写一份的话，
 * 「正在下载时又点了一次检查」这类交叉情况一定会漏。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  clearQuarantineAttributes,
  currentVersion,
  recordUpdateAttempt,
  restartApp,
  updateInstallPreflight,
  type Update,
} from "../ipc/update";
import { useAppStore } from "../store/appStore";
import { describeProxy } from "../lib/updateProxy";
import {
  classifyUpdateError,
  type UpdateFailureReason,
} from "../lib/updateFailure";
import {
  CHECK_INTERVAL_MS,
  decideAutoCheck,
  shouldPrompt,
  STARTUP_DELAY_MS,
  TYPING_GRACE_MS,
} from "../lib/updateSchedule";
import { logger } from "../lib/logger";

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; update: Update }
  | {
      kind: "downloading";
      update: Update;
      downloaded: number;
      total: number | null;
    }
  | { kind: "installing"; update: Update }
  | { kind: "failed"; reason: UpdateFailureReason };

interface UseUpdateFlowOptions {
  /** 启动流程是否已完成（前端就绪 + 启动文件已打开） */
  ready: boolean;
  /** 最近一次编辑活动的时间戳。用 getter 而不是值，否则每敲一下键都要重渲染 */
  getLastEditAt: () => number;
  /** 下载完成后的未保存内容保护；返回 false 表示用户取消了更新 */
  confirmInstall: () => Promise<boolean>;
}

export interface UpdateFlow {
  phase: UpdatePhase;
  /** 弹窗是否可见。手动检查会绕过压制规则 */
  prompting: boolean;
  /** 当前运行的版本，取自 `getVersion()` */
  version: string;
  checkNow: () => void;
  install: () => void;
  remindLater: () => void;
  skipVersion: () => void;
  dismiss: () => void;
}

export function useUpdateFlow({
  ready,
  getLastEditAt,
  confirmInstall,
}: UseUpdateFlowOptions): UpdateFlow {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [prompting, setPrompting] = useState(false);
  const [version, setVersion] = useState("");
  // 只在回调里读，不参与渲染；做成 state 会让 checkNow 的引用每次变化
  const remindAfterRef = useRef(0);

  const autoCheckUpdates = useAppStore((state) => state.autoCheckUpdates);
  const updateProxyServer = useAppStore((state) => state.updateProxyServer);
  const updateIgnoreSystemProxy = useAppStore(
    (state) => state.updateIgnoreSystemProxy,
  );
  const lastSeenVersion = useAppStore((state) => state.lastSeenVersion);
  const lastUpdateCheckAt = useAppStore((state) => state.lastUpdateCheckAt);
  const skippedVersion = useAppStore((state) => state.skippedVersion);
  const patchConfig = useAppStore((state) => state.patchConfig);

  // 这些值只在回调里读，放进依赖会让启动检查被反复重跑
  const settingsRef = useRef({
    autoCheckUpdates,
    updateProxyServer,
    updateIgnoreSystemProxy,
    lastSeenVersion,
    lastUpdateCheckAt,
    skippedVersion,
  });
  const patchRef = useRef(patchConfig);
  const confirmRef = useRef(confirmInstall);
  const lastEditRef = useRef(getLastEditAt);

  useEffect(() => {
    settingsRef.current = {
      autoCheckUpdates,
      updateProxyServer,
      updateIgnoreSystemProxy,
      lastSeenVersion,
      lastUpdateCheckAt,
      skippedVersion,
    };
    patchRef.current = patchConfig;
    confirmRef.current = confirmInstall;
    lastEditRef.current = getLastEditAt;
  });

  const runCheck = useCallback(async (manual: boolean) => {
    const cfg = settingsRef.current;
    setPhase({ kind: "checking" });
    logger.info(
      `checking for updates (manual=${manual}, proxy ${describeProxy(cfg.updateProxyServer)})`,
    );
    try {
      const update = await checkForUpdate({
        proxyServer: cfg.updateProxyServer,
        ignoreSystemProxy: cfg.updateIgnoreSystemProxy,
      });
      patchRef.current({ lastUpdateCheckAt: Date.now() });

      if (!update) {
        setPhase({ kind: "upToDate" });
        setPrompting(manual);
        return;
      }
      setPhase({ kind: "available", update });
      setPrompting(
        manual ||
          shouldPrompt({
            availableVersion: update.version,
            skippedVersion: cfg.skippedVersion,
            remindAfter: remindAfterRef.current,
            now: Date.now(),
          }),
      );
    } catch (error) {
      const reason = classifyUpdateError(error);
      logger.warn(`update check failed (${reason})`);
      setPhase({ kind: "failed", reason });
      setPrompting(manual);
    }
  }, []);

  // 启动后延迟检查，避开启动 IO 高峰
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const version = await currentVersion();
        if (cancelled) return;
        setVersion(version);
        const cfg = settingsRef.current;
        const decision = decideAutoCheck({
          autoCheckUpdates: cfg.autoCheckUpdates,
          lastSeenVersion: cfg.lastSeenVersion,
          currentVersion: version,
          lastUpdateCheckAt: cfg.lastUpdateCheckAt,
          now: Date.now(),
          isDebug: import.meta.env.DEV,
        });
        // 无条件记下本次启动的版本，下次启动才能识别出「刚升级过」
        if (cfg.lastSeenVersion !== version) {
          patchRef.current({ lastSeenVersion: version });
        }
        if (decision.check) void runCheck(false);
      })();
    }, STARTUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, runCheck]);

  // 正在输入时不抢焦点，等空闲下来再弹
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    if (phase.kind !== "available" || !prompting) return;
    const idleFor = Date.now() - lastEditRef.current();
    if (idleFor >= TYPING_GRACE_MS) {
      setDeferred(false);
      return;
    }
    setDeferred(true);
    const timer = setTimeout(
      () => setDeferred(false),
      TYPING_GRACE_MS - idleFor,
    );
    return () => clearTimeout(timer);
  }, [phase, prompting]);

  const checkNow = useCallback(() => void runCheck(true), [runCheck]);

  const install = useCallback(() => {
    if (phase.kind !== "available") return;
    const { update } = phase;
    void (async () => {
      try {
        // 先问能不能装。等下完几十 MB 才发现写不进去，用户白等一场
        const preflight = await updateInstallPreflight();
        if (preflight.runningFromMount) {
          setPhase({ kind: "failed", reason: "mountedVolume" });
          return;
        }
        if (!preflight.writable) {
          setPhase({ kind: "failed", reason: "notWritable" });
          return;
        }

        let downloaded = 0;
        let total: number | null = null;
        setPhase({ kind: "downloading", update, downloaded, total });
        await update.download((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
          }
          setPhase({ kind: "downloading", update, downloaded, total });
        });

        // 字节数对不上说明下载被截断或被中间人改过，装下去比不装危险得多
        if (total !== null && downloaded !== total) {
          logger.warn(
            `update download size mismatch: got ${downloaded}, expected ${total}`,
          );
          setPhase({ kind: "failed", reason: "sizeMismatch" });
          return;
        }

        // 装完就重启，脏文档必须先落盘（SPEC §12.3.3 第 4 条）
        if (!(await confirmRef.current())) {
          setPhase({ kind: "available", update });
          return;
        }
        setPhase({ kind: "installing", update });

        // 安装会替换掉本进程，没有别的回执可拿；先落一条记录，
        // 下次启动比对版本号就知道装没装上
        await recordUpdateAttempt(update.version);
        await update.install();
        // 不做公证，不清隔离属性的话新 bundle 会被 Gatekeeper 拦下
        await clearQuarantineAttributes();
        await restartApp();
      } catch (error) {
        const reason = classifyUpdateError(error);
        logger.warn(`update install failed (${reason})`);
        setPhase({ kind: "failed", reason });
      }
    })();
  }, [phase]);

  const remindLater = useCallback(() => {
    remindAfterRef.current = Date.now() + CHECK_INTERVAL_MS;
    setPrompting(false);
  }, []);

  const skipVersion = useCallback(() => {
    if (phase.kind === "available") {
      patchRef.current({ skippedVersion: phase.update.version });
    }
    setPrompting(false);
  }, [phase]);

  const dismiss = useCallback(() => setPrompting(false), []);

  return {
    phase,
    prompting: prompting && !deferred,
    version,
    checkNow,
    install,
    remindLater,
    skipVersion,
    dismiss,
  };
}
