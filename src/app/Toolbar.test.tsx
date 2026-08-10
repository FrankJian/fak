import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "./Toolbar";

function renderToolbar(onSaveAs = vi.fn(), canSaveAs = true) {
  render(
    <Toolbar
      onNew={vi.fn()}
      onOpen={vi.fn()}
      onOpenFolder={vi.fn()}
      onSave={vi.fn()}
      onSaveAs={onSaveAs}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onOpenCommandPalette={vi.fn()}
      onToggleMarkdownPreview={vi.fn()}
      canSave
      canSaveAs={canSaveAs}
      canEdit
      canPreviewMarkdown={false}
      markdownPreviewVisible={false}
    />,
  );
  return onSaveAs;
}

describe("Toolbar Save As", () => {
  it("exposes the action with its shortcut and runs it", () => {
    const onSaveAs = renderToolbar();
    fireEvent.click(
      screen.getByRole("button", { name: /另存为.*Ctrl\+Shift\+S/ }),
    );
    expect(onSaveAs).toHaveBeenCalledOnce();
  });

  it("disables Save As when no editable document is active", () => {
    renderToolbar(vi.fn(), false);
    expect(
      screen.getByRole("button", { name: /另存为.*Ctrl\+Shift\+S/ }),
    ).toBeDisabled();
  });

  it("在 macOS 上把撤销快捷键显示为 Command+Z", () => {
    const platform = vi
      .spyOn(window.navigator, "platform", "get")
      .mockReturnValue("MacIntel");

    renderToolbar();

    expect(screen.getByRole("button", { name: /撤销.*⌘Z/ })).toBeEnabled();
    platform.mockRestore();
  });
});
