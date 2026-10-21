import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTreeContextMenu, FileTreeDeleteDialog } from "./FileTreeActions";

describe("FileTreeContextMenu", () => {
  it("uses the shared menu spacing and supports keyboard navigation", async () => {
    render(
      <FileTreeContextMenu
        node={{ path: "/work/notes.md", name: "notes.md", kind: "file" }}
        x={20}
        y={30}
        canModify
        isRoot={false}
        onClose={vi.fn()}
        onCreateFile={vi.fn()}
        onCreateFolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onCopyPath={vi.fn()}
        onCopyRelativePath={vi.fn()}
        onReveal={vi.fn()}
        onRemoveRoot={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu")).toHaveClass(
      "rounded-[var(--radius-panel)]",
      "p-[var(--space-1)]",
    );
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(7);
    expect(items.every((item) => item.querySelector("svg") !== null)).toBe(true);
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
  });

  it("offers removing the workspace folder only on the root node", () => {
    const removeRoot = vi.fn();
    render(
      <FileTreeContextMenu
        node={{ path: "/work", name: "work", kind: "directory" }}
        x={20}
        y={30}
        canModify={false}
        isRoot
        onClose={vi.fn()}
        onCreateFile={vi.fn()}
        onCreateFolder={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onCopyPath={vi.fn()}
        onCopyRelativePath={vi.fn()}
        onReveal={vi.fn()}
        onRemoveRoot={removeRoot}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "从文件树移除文件夹" }));
    expect(removeRoot).toHaveBeenCalledOnce();
  });
});

describe("FileTreeDeleteDialog", () => {
  it("warns that deleting an open file discards unsaved edits", () => {
    render(
      <FileTreeDeleteDialog
        node={{ path: "/work/notes.md", name: "notes.md", kind: "file" }}
        permanent={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/未保存的修改将丢失/)).toBeInTheDocument();
  });
});
