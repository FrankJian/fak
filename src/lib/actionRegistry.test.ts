import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActions,
  filterActions,
  getAction,
  getDefaultShortcut,
  isEnabled,
  isRopeDocumentReady,
  listActions,
  listShortcutActions,
  registerAction,
  scoreMatch,
  setShortcutOverrides,
  type ActionContext,
  type ActionDefinition,
} from "./actionRegistry";
import type { MessageKey } from "../i18n";

const context: ActionContext = {
  hasDocument: true,
  isDirty: false,
  canUndo: false,
  canRedo: false,
  isResyncing: false,
  isStream: false,
  hasPendingBackups: false,
  hasCompareSource: false,
  inDiff: false,
  isMarkdown: false,
};

function action(
  id: string,
  titleKey: MessageKey,
  extra: Partial<ActionDefinition> = {},
) {
  registerAction({
    id,
    titleKey,
    categoryKey: "toolbar.newFile",
    run: () => {},
    ...extra,
  });
}

describe("scoreMatch", () => {
  it("matches a subsequence, not just a prefix", () => {
    expect(scoreMatch("Save All", "sa")).not.toBeNull();
    expect(scoreMatch("Save All", "sl")).not.toBeNull();
  });

  it("rejects characters that appear out of order", () => {
    expect(scoreMatch("Save All", "as")).toBeNull();
  });

  it("reports the matched indices so the palette can highlight them", () => {
    expect(scoreMatch("Save All", "sa")?.matched).toEqual([0, 1]);
  });

  it("ranks a word-start match above a mid-word one", () => {
    const wordStart = scoreMatch("Save All", "sa")?.score ?? 0;
    const midWord = scoreMatch("Search", "sa")?.score ?? 0;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("is case insensitive", () => {
    expect(scoreMatch("Save All", "SAVE")).not.toBeNull();
  });

  it("matches everything on an empty query", () => {
    expect(scoreMatch("anything", "")).toEqual({ score: 0, matched: [] });
  });
});

describe("registry", () => {
  beforeEach(() => {
    clearActions();
    setShortcutOverrides({});
  });

  it("stores and retrieves actions by id", () => {
    action("file.save", "toolbar.save");
    expect(getAction("file.save")?.titleKey).toBe("toolbar.save");
    expect(listActions()).toHaveLength(1);
  });

  it("lets a later registration replace an earlier one with the same id", () => {
    action("file.save", "toolbar.save");
    action("file.save", "toolbar.saveAll");
    expect(listActions()).toHaveLength(1);
    expect(getAction("file.save")?.titleKey).toBe("toolbar.saveAll");
  });

  it("treats an action without a when predicate as always enabled", () => {
    action("file.save", "toolbar.save");
    const saved = getAction("file.save");
    expect(saved && isEnabled(saved, context)).toBe(true);
  });

  it("honours the when predicate", () => {
    action("edit.undo", "toolbar.undo", { when: (ctx) => ctx.canUndo });
    const undo = getAction("edit.undo");
    expect(undo && isEnabled(undo, context)).toBe(false);
    expect(undo && isEnabled(undo, { ...context, canUndo: true })).toBe(true);
  });

  it("disables Rope-backed commands for stream documents", () => {
    expect(isRopeDocumentReady(context)).toBe(true);
    expect(isRopeDocumentReady({ ...context, isStream: true })).toBe(false);
    expect(isRopeDocumentReady({ ...context, isResyncing: true })).toBe(false);
  });

  it("runs the action body", async () => {
    const run = vi.fn();
    action("file.save", "toolbar.save", { run });
    await getAction("file.save")?.run(context);
    expect(run).toHaveBeenCalledOnce();
  });

  it("uses a persisted shortcut override without changing the default", () => {
    action("file.save", "toolbar.save", { shortcut: "Ctrl+S" });
    setShortcutOverrides({ "file.save": "Ctrl+Shift+S" });

    expect(getAction("file.save")?.shortcut).toBe("Ctrl+Shift+S");
    expect(getDefaultShortcut("file.save")).toBe("Ctrl+S");
  });

  it("keeps an unbound default action in the shortcut settings list", () => {
    action("file.save", "toolbar.save", { shortcut: "Ctrl+S" });
    setShortcutOverrides({ "file.save": "" });

    expect(listShortcutActions()).toMatchObject([
      { id: "file.save", shortcut: undefined },
    ]);
  });
});

describe("filterActions", () => {
  const translate = (key: MessageKey) =>
    ({
      "toolbar.save": "Save",
      "toolbar.saveAll": "Save All",
      "toolbar.find": "Find",
    })[key as string] ?? String(key);

  beforeEach(() => {
    clearActions();
    setShortcutOverrides({});
    action("file.save", "toolbar.save");
    action("file.saveAll", "toolbar.saveAll");
    action("search.find", "toolbar.find");
  });

  it("keeps only the matching actions", () => {
    const ids = filterActions(listActions(), "find", translate).map(
      (item) => item.action.id,
    );
    expect(ids).toEqual(["search.find"]);
  });

  it("ranks the shorter exact-ish title first", () => {
    const ids = filterActions(listActions(), "save", translate).map(
      (item) => item.action.id,
    );
    expect(ids[0]).toBe("file.save");
  });

  it("returns everything for an empty query", () => {
    expect(filterActions(listActions(), "", translate)).toHaveLength(3);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterActions(listActions(), "zzz", translate)).toHaveLength(0);
  });

  it("matches Chinese titles by pinyin initials without invalid title highlights", () => {
    const results = filterActions(
      listActions(),
      "bc",
      (key) => (key === "toolbar.save" ? "保存" : translate(key)),
      new Map([["file.save", "bc"]]),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      action: { id: "file.save" },
      matched: [],
    });
  });

  it("ranks visible title matches above pinyin-only matches", () => {
    const results = filterActions(
      listActions(),
      "save",
      translate,
      new Map([["search.find", "save"]]),
    );

    expect(results[0].action.id).toBe("file.save");
  });

  it("filters one thousand actions within one frame", () => {
    const actions: ActionDefinition[] = Array.from(
      { length: 1_000 },
      (_, index) => ({
        id: `test.${index}`,
        titleKey: "toolbar.save",
        categoryKey: "toolbar.newFile",
        run: () => {},
      }),
    );
    const startedAt = performance.now();
    const results = filterActions(actions, "save", translate);

    expect(results).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(16);
  });
});
