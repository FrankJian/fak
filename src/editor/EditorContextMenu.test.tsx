import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorContextMenu, type EditorMenuEntry } from "./EditorContextMenu";

const entries = [
  {
    id: "edit.copy",
    labelKey: "edit.copy",
    icon: "copy",
    shortcut: "Ctrl+C",
    disabled: false,
  },
  {
    id: "edit.paste",
    labelKey: "edit.paste",
    icon: "paste",
    shortcut: "Ctrl+V",
    disabled: false,
  },
] as EditorMenuEntry[];

describe("EditorContextMenu", () => {
  it("展示动作图标对应的占位与快捷键提示", () => {
    const { container } = render(
      <EditorContextMenu
        x={20}
        y={30}
        entries={entries}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Ctrl+C")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+V")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("可用菜单项使用清晰的活动背景作为鼠标悬停反馈", () => {
    render(
      <EditorContextMenu
        x={20}
        y={30}
        entries={entries}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("menuitem")[0]).toHaveClass(
      "enabled:hover:bg-[var(--bg-active)]",
    );
  });

  it("打开后聚焦首项，并支持上下方向键导航", async () => {
    render(
      <EditorContextMenu
        x={20}
        y={30}
        entries={entries}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();
  });
});
