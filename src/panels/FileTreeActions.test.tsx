import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTreeContextMenu } from "./FileTreeActions";

describe("FileTreeContextMenu", () => {
  it("uses the shared menu spacing and supports keyboard navigation", async () => {
    render(
      <FileTreeContextMenu
        node={{ path: "/work/notes.md", name: "notes.md", kind: "file" }}
        x={20}
        y={30}
        canModify
        onClose={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onCopyPath={vi.fn()}
        onCopyRelativePath={vi.fn()}
        onReveal={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu")).toHaveClass(
      "rounded-[var(--radius-panel)]",
      "p-[var(--space-1)]",
    );
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.querySelector("svg") !== null)).toBe(true);
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
  });
});
