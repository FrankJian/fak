import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearActions,
  getDefaultShortcut,
  getAction,
  isEnabled,
  type ActionContext,
} from "../lib/actionRegistry";
import { registerWorkspaceActions } from "./registerWorkspaceActions";

type RegisterArgs = Parameters<typeof registerWorkspaceActions>;

const context: ActionContext = {
  hasDocument: true,
  isDirty: false,
  canUndo: false,
  canRedo: false,
  canFormatDocument: true,
  isResyncing: false,
  isStream: false,
  hasPendingBackups: false,
  hasCompareSource: false,
  inDiff: false,
  isMarkdown: false,
};

describe("workspace action shortcuts", () => {
  afterEach(clearActions);

  it("uses the platform modifier for undo so Command+Z works on macOS", () => {
    registerWorkspaceActions(
      {} as RegisterArgs[0],
      {} as RegisterArgs[1],
      {} as RegisterArgs[2],
      {} as RegisterArgs[3],
    );

    expect(getDefaultShortcut("edit.undo")).toBe("Mod+Z");
  });

  it("binds the file tree toggle to the cross-platform explorer shortcut", () => {
    registerWorkspaceActions(
      {} as RegisterArgs[0],
      {} as RegisterArgs[1],
      {} as RegisterArgs[2],
      {} as RegisterArgs[3],
    );

    expect(getDefaultShortcut("view.fileTree")).toBe("Mod+Shift+E");
  });

  it("enables format actions from the current file context after opening a JSON file", () => {
    registerWorkspaceActions(
      {} as RegisterArgs[0],
      {} as RegisterArgs[1],
      {} as RegisterArgs[2],
      {
        formatSyntax: () => null,
      } as RegisterArgs[3],
    );

    const format = getAction("edit.formatDocument");
    const minify = getAction("edit.minifyDocument");

    expect(format && isEnabled(format, context)).toBe(true);
    expect(minify && isEnabled(minify, context)).toBe(true);
    expect(
      format && isEnabled(format, { ...context, canFormatDocument: false }),
    ).toBe(false);
  });

  it("exposes Mermaid image exports only while a rendered diagram is available", () => {
    let available = false;
    registerWorkspaceActions(
      {} as RegisterArgs[0],
      {} as RegisterArgs[1],
      { hasMermaidDiagram: () => available } as RegisterArgs[2],
      {} as RegisterArgs[3],
    );
    const png = getAction("markdown.exportPng");
    const svg = getAction("markdown.exportSvg");
    expect(png && isEnabled(png, context)).toBe(false);
    expect(svg && isEnabled(svg, context)).toBe(false);
    available = true;
    expect(png && isEnabled(png, context)).toBe(true);
    expect(svg && isEnabled(svg, context)).toBe(true);
  });

  it("exposes every preset theme as an immediately applicable command", () => {
    const setTheme = vi.fn();
    registerWorkspaceActions(
      {} as RegisterArgs[0],
      {} as RegisterArgs[1],
      { setTheme } as unknown as RegisterArgs[2],
      {} as RegisterArgs[3],
    );

    const theme = getAction("settings.theme.highContrastCyan");
    expect(theme).toBeDefined();
    void theme?.run(context);
    expect(setTheme).toHaveBeenCalledWith("highContrastCyan");
  });
});
