import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActions,
  registerAction,
  type ActionContext,
} from "../lib/actionRegistry";
import { SEQUENCE_TIMEOUT_MS, useKeyboard } from "./useKeyboard";

const context: ActionContext = {
  hasDocument: true,
  isDirty: false,
  canUndo: false,
  canRedo: false,
  canFormatDocument: false,
  isResyncing: false,
  isStream: false,
  hasPendingBackups: false,
  hasCompareSource: false,
  inDiff: false,
  isMarkdown: false,
};

function press(key: string) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key,
    }),
  );
}

describe("useKeyboard sequences", () => {
  beforeEach(() => {
    clearActions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearActions();
    vi.useRealTimers();
  });

  it("runs the sequence action instead of its single-chord fallback", () => {
    const fallback = vi.fn();
    const sequence = vi.fn();
    registerAction({
      id: "fallback",
      titleKey: "settings.open",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K",
      run: fallback,
    });
    registerAction({
      id: "sequence",
      titleKey: "settings.keyboardShortcuts",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K Ctrl+S",
      run: sequence,
    });
    renderHook(() => useKeyboard(context));

    act(() => {
      press("k");
      press("s");
    });

    expect(sequence).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("runs the single-chord action when the sequence times out", () => {
    const fallback = vi.fn();
    registerAction({
      id: "fallback",
      titleKey: "settings.open",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K",
      run: fallback,
    });
    registerAction({
      id: "sequence",
      titleKey: "settings.keyboardShortcuts",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K Ctrl+S",
      run: vi.fn(),
    });
    renderHook(() => useKeyboard(context));

    act(() => {
      press("k");
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS);
    });

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("routes shared prefixes to the matching sequence", () => {
    const settings = vi.fn();
    const close = vi.fn();
    registerAction({
      id: "settings",
      titleKey: "settings.keyboardShortcuts",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K Ctrl+S",
      run: settings,
    });
    registerAction({
      id: "close",
      titleKey: "dialog.close",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K Ctrl+W",
      run: close,
    });
    renderHook(() => useKeyboard(context));

    act(() => {
      press("k");
      press("w");
    });

    expect(close).toHaveBeenCalledOnce();
    expect(settings).not.toHaveBeenCalled();
  });

  it("runs sequences longer than two chords", () => {
    const action = vi.fn();
    registerAction({
      id: "three-chord",
      titleKey: "settings.keyboardShortcuts",
      categoryKey: "category.edit",
      shortcut: "Ctrl+K Ctrl+S Ctrl+T",
      run: action,
    });
    renderHook(() => useKeyboard(context));

    act(() => {
      press("k");
      press("s");
      press("t");
    });

    expect(action).toHaveBeenCalledOnce();
  });

  it("handles an app shortcut before the editor consumes the keydown", () => {
    const openFind = vi.fn();
    registerAction({
      id: "find.open",
      titleKey: "find.open",
      categoryKey: "category.edit",
      shortcut: "Ctrl+F",
      run: openFind,
    });
    renderHook(() => useKeyboard(context));

    const editor = document.createElement("div");
    editor.addEventListener("keydown", (event) => event.preventDefault());
    document.body.appendChild(editor);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "f",
    });

    act(() => editor.dispatchEvent(event));

    expect(openFind).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    editor.remove();
  });
});
