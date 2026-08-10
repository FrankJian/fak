import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { DEFAULT_CONFIG } from "../ipc/config";
import {
  appearanceExtensions,
  fakTheme,
  indentExtensions,
  type Appearance,
} from "./extensions";

const base: Appearance = {
  fontFamily: DEFAULT_CONFIG.fontFamily,
  fontSize: DEFAULT_CONFIG.fontSize,
  lineHeight: DEFAULT_CONFIG.lineHeight,
  letterSpacing: DEFAULT_CONFIG.letterSpacing,
  fontLigatures: DEFAULT_CONFIG.fontLigatures,
  tabWidth: DEFAULT_CONFIG.tabWidth,
  tabIndentMode: DEFAULT_CONFIG.tabIndentMode,
  showLineNumbers: DEFAULT_CONFIG.showLineNumbers,
  highlightCurrentLine: DEFAULT_CONFIG.highlightCurrentLine,
  wordWrap: DEFAULT_CONFIG.wordWrap,
  cursorStyle: DEFAULT_CONFIG.cursorStyle,
  cursorBlink: DEFAULT_CONFIG.cursorBlink,
  rulers: DEFAULT_CONFIG.rulers,
  pasteImageMode: DEFAULT_CONFIG.pasteImageMode,
};

describe("缩进设置", () => {
  it("空格模式下缩进单位宽度等于 tabWidth", () => {
    expect(
      indentExtensions({ ...base, tabIndentMode: "spaces", tabWidth: 2 }),
    ).toHaveLength(2);
    expect(
      indentExtensions({ ...base, tabIndentMode: "tabs", tabWidth: 8 }),
    ).toHaveLength(2);
  });
});

describe("外观扩展", () => {
  it("正文编辑区使用文本光标，而不是继承桌面的默认箭头", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ extensions: [fakTheme] }),
    });

    expect(getComputedStyle(view.contentDOM).cursor).toBe("text");

    view.destroy();
    parent.remove();
  });

  it("文本选区使用专用背景色，而不是被当前行高亮淹没", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ extensions: [fakTheme] }),
    });
    const selection = document.createElement("div");
    selection.className = "cm-selectionBackground";
    view.dom.append(selection);

    expect(getComputedStyle(selection).backgroundColor).toBe(
      "var(--selection-bg)",
    );

    view.destroy();
    parent.remove();
  });

  it("关掉行号就不装 lineNumbers", () => {
    const withNumbers = appearanceExtensions(
      { ...base, showLineNumbers: true },
      "full",
    );
    const without = appearanceExtensions(
      { ...base, showLineNumbers: false },
      "full",
    );
    expect(without.length).toBeLessThan(withNumbers.length);
  });

  it("自动换行是可选项，不装则不影响其余扩展", () => {
    const wrapped = appearanceExtensions({ ...base, wordWrap: true }, "full");
    const unwrapped = appearanceExtensions(
      { ...base, wordWrap: false },
      "full",
    );
    expect(wrapped.length).toBe(unwrapped.length + 1);
  });

  // 活动行装饰要跟随每次滚动重算，Tier B 上会把交互拖垮（SPEC §4.1 降级表）
  it("Tier B 不装活动行高亮，哪怕设置里开着", () => {
    const tierA = appearanceExtensions(
      { ...base, highlightCurrentLine: true },
      "full",
    );
    const tierB = appearanceExtensions(
      { ...base, highlightCurrentLine: true },
      "lean",
    );
    expect(tierB.length).toBe(tierA.length - 2);
  });
});
