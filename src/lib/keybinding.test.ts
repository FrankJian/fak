import { describe, expect, it } from "vitest";
import {
  chordFromEvent,
  chordId,
  detectShortcutConflicts,
  findUnparsableShortcuts,
  formatChord,
  formatShortcut,
  isTextEntryTarget,
  parseChord,
  parseShortcut,
} from "./keybinding";

const event = (
  key: string,
  mods: Partial<Record<"ctrl" | "alt" | "shift" | "meta", boolean>> = {},
) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false,
});

describe("parseChord", () => {
  it("拆出修饰键与主键", () => {
    expect(parseChord("Ctrl+Shift+P", "other")).toEqual({
      key: "p",
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it("Mod 在两个平台落到不同的修饰键上", () => {
    expect(parseChord("Mod+S", "other")?.ctrl).toBe(true);
    expect(parseChord("Mod+S", "other")?.meta).toBe(false);
    expect(parseChord("Mod+S", "mac")?.meta).toBe(true);
    expect(parseChord("Mod+S", "mac")?.ctrl).toBe(false);
  });

  it("修饰键的书写顺序不影响结果", () => {
    const a = parseChord("Ctrl+Shift+P", "other");
    const b = parseChord("Shift+Ctrl+P", "other");
    expect(a && chordId(a)).toBe(b && chordId(b));
  });

  it("别名归一到 event.key 的形式", () => {
    expect(parseChord("Esc", "other")?.key).toBe("escape");
    expect(parseChord("Ctrl+Up", "other")?.key).toBe("arrowup");
    expect(parseChord("Space", "other")?.key).toBe(" ");
  });

  it("功能键与 Tab 原样保留（小写）", () => {
    expect(parseChord("F3", "other")?.key).toBe("f3");
    expect(parseChord("Ctrl+Tab", "other")?.key).toBe("tab");
  });

  // 手误必须报错而不是被当成一个名叫 crtl 的修饰键静默吞掉
  it("无法识别的修饰键返回 null", () => {
    expect(parseChord("Crtl+S", "other")).toBeNull();
  });

  it("只有修饰键、没有主键的声明返回 null", () => {
    expect(parseChord("Ctrl+Shift", "other")).toBeNull();
    expect(parseChord("", "other")).toBeNull();
  });
});

describe("chordFromEvent", () => {
  it("按下的大写字母归一成小写，与声明侧对齐", () => {
    const fromEvent = chordFromEvent(event("P", { ctrl: true, shift: true }));
    const fromSpec = parseChord("Ctrl+Shift+P", "other");
    expect(fromSpec && chordId(fromSpec)).toBe(chordId(fromEvent));
  });

  it("F3 与 Shift+F3 是两个不同的组合", () => {
    expect(chordId(chordFromEvent(event("F3")))).not.toBe(
      chordId(chordFromEvent(event("F3", { shift: true }))),
    );
  });

  // 浏览器给的是上档字符，不还原就会让 SPEC F13 的这几条静默失效
  it.each([
    ["Ctrl+Shift+[", "{"],
    ["Ctrl+Shift+]", "}"],
    ["Ctrl+Shift+`", "~"],
  ])("%s 能匹配上档字符 %s", (spec, shifted) => {
    const fromEvent = chordFromEvent(
      event(shifted, { ctrl: true, shift: true }),
    );
    const fromSpec = parseChord(spec, "other");
    expect(fromSpec && chordId(fromSpec)).toBe(chordId(fromEvent));
  });

  it("Alt+Shift+5 能匹配上档字符 %", () => {
    const fromEvent = chordFromEvent(event("%", { alt: true, shift: true }));
    const fromSpec = parseChord("Alt+Shift+5", "other");
    expect(fromSpec && chordId(fromSpec)).toBe(chordId(fromEvent));
  });

  it("没按 Shift 时不做上档还原，否则会把 ~ 错当成 `", () => {
    expect(chordId(chordFromEvent(event("~")))).toBe("~");
  });

  it("多按了一个修饰键就不再匹配", () => {
    const declared = parseChord("Ctrl+S", "other");
    const pressed = chordFromEvent(event("s", { ctrl: true, alt: true }));
    expect(declared && chordId(declared)).not.toBe(chordId(pressed));
  });
});

describe("formatChord", () => {
  it("Windows 上用文字加号连接", () => {
    expect(formatChord("Ctrl+Shift+P", "other")).toBe("Ctrl+Shift+P");
  });

  it("macOS 上用符号且不带分隔符", () => {
    expect(formatChord("Mod+Shift+P", "mac")).toBe("⇧⌘P");
  });

  it("功能键整体大写", () => {
    expect(formatChord("Shift+F3", "other")).toBe("Shift+F3");
  });

  // 解析不了就原样显示：显示层不该因为一个手误而崩掉
  it("无法解析的声明原样返回", () => {
    expect(formatChord("Crtl+S", "other")).toBe("Crtl+S");
  });
});

describe("shortcut sequences", () => {
  it("解析空格分隔的多个 chord", () => {
    expect(parseShortcut("Ctrl+K Ctrl+S", "other")?.map(chordId)).toEqual([
      "ctrl+k",
      "ctrl+s",
    ]);
  });

  it("按平台格式化组合序列", () => {
    expect(formatShortcut("Ctrl+K Ctrl+S", "other")).toBe("Ctrl+K Ctrl+S");
    expect(formatShortcut("Mod+K Mod+S", "mac")).toBe("⌘K, ⌘S");
  });
});

describe("detectShortcutConflicts", () => {
  it("同一组合绑到两个动作上会被报出来", () => {
    const conflicts = detectShortcutConflicts(
      [
        { id: "a", shortcut: "Ctrl+S" },
        { id: "b", shortcut: "Ctrl+S" },
        { id: "c", shortcut: "Ctrl+O" },
      ],
      "other",
    );
    expect(conflicts).toEqual([{ chord: "ctrl+s", ids: ["a", "b"] }]);
  });

  it("书写顺序不同但组合相同，仍算冲突", () => {
    const conflicts = detectShortcutConflicts(
      [
        { id: "a", shortcut: "Ctrl+Shift+P" },
        { id: "b", shortcut: "Shift+Ctrl+P" },
      ],
      "other",
    );
    expect(conflicts).toHaveLength(1);
  });

  it("没有声明快捷键的动作不参与检测", () => {
    expect(
      detectShortcutConflicts([{ id: "a" }, { id: "b" }], "other"),
    ).toEqual([]);
  });

  // Mod 在 mac 上落到 Command，与显式写 Ctrl 的动作不再冲突
  it("平台不同，冲突结论可能不同", () => {
    const entries = [
      { id: "a", shortcut: "Mod+S" },
      { id: "b", shortcut: "Ctrl+S" },
    ];
    expect(detectShortcutConflicts(entries, "other")).toHaveLength(1);
    expect(detectShortcutConflicts(entries, "mac")).toHaveLength(0);
  });

  it("相同组合序列会被报出来", () => {
    const conflicts = detectShortcutConflicts(
      [
        { id: "a", shortcut: "Ctrl+K Ctrl+S" },
        { id: "b", shortcut: "Ctrl+K Ctrl+S" },
        { id: "c", shortcut: "Ctrl+K Ctrl+O" },
      ],
      "other",
    );
    expect(conflicts).toEqual([{ chord: "ctrl+k ctrl+s", ids: ["a", "b"] }]);
  });
});

describe("findUnparsableShortcuts", () => {
  it("拼错的修饰键会被挑出来", () => {
    expect(
      findUnparsableShortcuts([{ id: "a", shortcut: "Crtl+S" }], "other"),
    ).toEqual([{ id: "a", shortcut: "Crtl+S" }]);
  });

  it("合法声明不报", () => {
    expect(
      findUnparsableShortcuts(
        [{ id: "a", shortcut: "Ctrl+Alt+Shift+F12" }],
        "other",
      ),
    ).toEqual([]);
  });

  it("序列里有拼错的 chord 会被挑出来", () => {
    expect(
      findUnparsableShortcuts(
        [{ id: "a", shortcut: "Ctrl+K Crtl+S" }],
        "other",
      ),
    ).toEqual([{ id: "a", shortcut: "Ctrl+K Crtl+S" }]);
  });
});

describe("isTextEntryTarget", () => {
  const html = (markup: string): Element => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    const element = host.firstElementChild;
    if (!element) throw new Error("测试标记里没有元素");
    return element;
  };

  it("文本输入框算", () => {
    expect(isTextEntryTarget(html('<input type="text" />'))).toBe(true);
    expect(isTextEntryTarget(html("<textarea></textarea>"))).toBe(true);
    expect(isTextEntryTarget(html("<input />"))).toBe(true);
  });

  it("按钮与勾选框不算", () => {
    expect(isTextEntryTarget(html('<input type="checkbox" />'))).toBe(false);
    expect(isTextEntryTarget(html("<button></button>"))).toBe(false);
  });

  it("普通的 contenteditable 算", () => {
    expect(isTextEntryTarget(html('<div contenteditable="true"></div>'))).toBe(
      true,
    );
    expect(isTextEntryTarget(html('<div contenteditable="false"></div>'))).toBe(
      false,
    );
  });

  // 撤销栈以 Rust 为准，编辑器里的 Ctrl+Z 必须走到全局动作上
  it("CodeMirror 正文不算输入框，哪怕它是 contenteditable", () => {
    const editor = html(
      '<div class="cm-editor"><div class="cm-content" contenteditable="true"></div></div>',
    );
    const content = editor.querySelector(".cm-content");
    expect(content && isTextEntryTarget(content)).toBe(false);
  });

  it("非元素目标不算", () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
