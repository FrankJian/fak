/**
 * 全局按键派发（SPEC F13 / P2-05 步骤 2、3）。
 *
 * 唯一的按键入口。匹配依据是 `actionRegistry` 里声明的 `shortcut` 字符串，
 * 所以「命令面板里显示的组合」与「真正生效的组合」不可能分叉——它们是同一个字符串。
 *
 * 编辑器内部的按键（多光标、缩进、移动行）仍归 CodeMirror 自己的 keymap 管：
 * 那些是编辑动作而不是应用动作，塞进注册表只会把命令面板淹掉。
 */
import { useEffect, useRef } from "react";
import {
  isEnabled,
  listActions,
  type ActionContext,
  type ActionDefinition,
} from "../lib/actionRegistry";
import {
  chordFromEvent,
  chordId,
  detectShortcutConflicts,
  isTextEntryTarget,
  parseShortcut,
  type Platform,
} from "../lib/keybinding";
import { logger } from "../lib/logger";

export const SEQUENCE_TIMEOUT_MS = 1_000;

interface SequenceCandidate {
  action: ActionDefinition;
  ids: string[];
}

interface PendingSequence {
  candidates: SequenceCandidate[];
  nextIndex: number;
  fallback: ActionDefinition | undefined;
  fallbackTarget: EventTarget | null;
  timer: ReturnType<typeof setTimeout>;
}

export function currentPlatform(): Platform {
  // `navigator.platform` 已废弃，但在 WebView2 与 WKWebView 上都还可靠，
  // 而 `userAgentData` 在 WKWebView 上根本不存在
  return /mac/i.test(navigator.platform) ? "mac" : "other";
}

function shortcutIds(
  action: ActionDefinition,
  platform: Platform,
): string[] | null {
  if (!action.shortcut) return null;
  const sequence = parseShortcut(action.shortcut, platform);
  return sequence?.map(chordId) ?? null;
}

function matches(
  action: ActionDefinition,
  pressed: string,
  platform: Platform,
): boolean {
  const ids = shortcutIds(action, platform);
  return ids?.length === 1 && ids[0] === pressed;
}

export function useKeyboard(context: ActionContext): void {
  // 监听器只绑一次，但每次按键要用最新的上下文。上下文是每次渲染新建的对象，
  // 放进依赖数组会让监听器跟着每次渲染解绑重绑
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });

  useEffect(() => {
    const platform = currentPlatform();
    let pending: PendingSequence | null = null;

    const run = (action: ActionDefinition, target: EventTarget | null) => {
      if (action.keyScope === "outsideTextInput" && isTextEntryTarget(target))
        return;
      if (!isEnabled(action, contextRef.current)) return;
      void action.run(contextRef.current);
    };
    const clearPending = (runFallback: boolean) => {
      if (!pending) return;
      clearTimeout(pending.timer);
      const { fallback, fallbackTarget } = pending;
      pending = null;
      if (runFallback && fallback) run(fallback, fallbackTarget);
    };
    const startPending = (
      candidates: SequenceCandidate[],
      nextIndex: number,
      fallback: ActionDefinition | undefined,
      fallbackTarget: EventTarget | null,
    ) => {
      pending = {
        candidates,
        nextIndex,
        fallback,
        fallbackTarget,
        timer: setTimeout(() => clearPending(true), SEQUENCE_TIMEOUT_MS),
      };
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // 输入法候选窗口要用方向键与回车，组合期间不许任何全局动作抢键
      // WebView2 在中文 IME 按 Enter 直接提交原始拼音时，偶尔会在
      // `isComposing` 清除前派发 keydown；229 是该阶段的兼容键码。
      if (event.isComposing || event.keyCode === 229) return;
      // 已被更靠近焦点的处理者消化掉（CodeMirror 的 keymap 就在那一层）
      if (event.defaultPrevented) return;

      const pressed = chordId(chordFromEvent(event));
      if (pending) {
        const matching = pending.candidates.filter(
          (candidate) => candidate.ids[pending!.nextIndex] === pressed,
        );
        if (matching.length > 0) {
          const nextIndex = pending.nextIndex + 1;
          const terminal = matching.find(
            (candidate) => candidate.ids.length === nextIndex,
          );
          const continuing = matching.filter(
            (candidate) => candidate.ids.length > nextIndex,
          );
          const fallback = terminal?.action ?? pending.fallback;
          const fallbackTarget = terminal
            ? event.target
            : pending.fallbackTarget;
          clearPending(false);
          event.preventDefault();
          if (continuing.length > 0) {
            startPending(continuing, nextIndex, fallback, fallbackTarget);
          } else if (terminal) {
            run(terminal.action, event.target);
          }
          return;
        }
        clearPending(true);
      }

      const actions = listActions();
      const sequences = actions
        .map((action) => {
          const ids = shortcutIds(action, platform);
          return ids && ids.length > 1 ? { action, ids } : null;
        })
        .filter(
          (candidate): candidate is SequenceCandidate => candidate !== null,
        )
        .filter(
          (candidate) =>
            candidate.ids[0] === pressed &&
            !(
              candidate.action.keyScope === "outsideTextInput" &&
              isTextEntryTarget(event.target)
            ),
        );
      if (sequences.length > 0) {
        event.preventDefault();
        startPending(
          sequences,
          1,
          actions.find((item) => matches(item, pressed, platform)),
          event.target,
        );
        return;
      }
      // 每次按键重新查一遍注册表：动作只有几十个，而人的按键频率在 20 次/秒以内。
      // 这点开销换来的是「注册表永远是最新的」，不必维护一份会过期的索引
      const action = actions.find((item) => matches(item, pressed, platform));
      if (!action) return;

      // 输入框里的编辑类快捷键让位给输入框自己：在查找框按 Ctrl+Z，
      // 用户想撤销的是刚打的查询词
      if (
        action.keyScope === "outsideTextInput" &&
        isTextEntryTarget(event.target)
      )
        return;

      // 条件不满足时**吞掉**而不是放行：Ctrl+S 落到 WebView 上会弹出
      // 宿主浏览器的「保存网页」对话框，那是彻底的越界
      event.preventDefault();
      run(action, event.target);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearPending(false);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // 只查一次：每次注册的都是同一批动作，重复检查只会刷屏。
    // 提交前由 `scripts/check-commands.mjs` 兜底，这里给的是开发时的即时反馈。
    // 消息不走 i18n：它只写进日志给开发者看，用户永远看不到
    for (const conflict of detectShortcutConflicts(
      listActions(),
      currentPlatform(),
    )) {
      logger.error(
        `shortcut conflict: ${conflict.chord} is bound to ${conflict.ids.join(", ")}`,
      );
    }
  }, []);
}
