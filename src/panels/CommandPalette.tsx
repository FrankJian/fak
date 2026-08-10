/**
 * 命令面板（SPEC F14）。
 *
 * 这是纯图标界面的第三项补偿（§6.6.2）：认不出图标的用户可以按名字找到同一个动作。
 * 所以这里只做检索与展示，动作本身一律由 `actionRegistry` 提供。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../i18n/useTranslation";
import {
  filterActions,
  isEnabled,
  listActions,
  type ActionContext,
} from "../lib/actionRegistry";
import { formatShortcut } from "../lib/keybinding";
import { currentPlatform } from "../app/useKeyboard";
import { commandPinyinInitials } from "../ipc/pinyin";
import { QuickInput, type QuickInputItem } from "./QuickInput";

interface CommandPaletteProps {
  onClose: () => void;
  onGoToLine: (initialQuery: string) => void;
  context: ActionContext;
}

/**
 * 由调用方控制挂载（`{open && <CommandPalette/>}`），所以这里不需要 `open` 属性：
 * 每次打开都是全新的组件实例，查询串与高亮项自然回到初始值，
 * 不必写一个「打开时清空」的 effect。
 */
export function CommandPalette({
  onClose,
  onGoToLine,
  context,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [pinyinInitials, setPinyinInitials] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const platform = currentPlatform();
  const actions = useMemo(() => listActions(), []);
  const titles = useMemo(
    () => actions.map((action) => t(action.titleKey)),
    [actions, t],
  );

  useEffect(() => {
    let cancelled = false;
    void commandPinyinInitials(titles)
      .then((initials) => {
        if (cancelled) return;
        setPinyinInitials(
          new Map(
            actions.map((action, index) => [action.id, initials[index] ?? ""]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setPinyinInitials(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [actions, titles]);

  const results = useMemo(
    () => filterActions(actions, query, t, pinyinInitials),
    [actions, pinyinInitials, query, t],
  );

  const items: QuickInputItem[] = results.map((hit) => ({
    id: hit.action.id,
    label: t(hit.action.titleKey),
    icon: hit.action.icon,
    matched: hit.matched,
    detail: hit.action.shortcut
      ? formatShortcut(hit.action.shortcut, platform)
      : undefined,
    disabled: !isEnabled(hit.action, context),
  }));

  const commit = (index: number) => {
    const hit = results[index];
    // 不可用的条目**看得见但按不动**，用户才知道功能存在、只是当前条件不满足
    if (!hit || !isEnabled(hit.action, context)) return;
    onClose();
    void hit.action.run(context);
  };

  return (
    <QuickInput
      icon="commandPalette"
      placeholder={t("commandPalette.placeholder")}
      emptyLabel={t("commandPalette.empty")}
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
