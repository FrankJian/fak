import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabContextMenu } from "./TabContextMenu";

afterEach(() => vi.restoreAllMocks());

function renderMenu(compareDisabled = true) {
  const actions = {
    onToggleLock: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCopyPath: vi.fn(),
    onRevealInFileManager: vi.fn(),
    onSetCompareSource: vi.fn(),
    onCompareWithSource: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <TabContextMenu
      x={40}
      y={50}
      locked={false}
      compareDisabled={compareDisabled}
      {...actions}
    />,
  );
  return actions;
}

describe("TabContextMenu", () => {
  it("uses the shared compact menu styling and semantic icons", () => {
    renderMenu();

    const menu = screen.getByRole("menu", { name: "标签页菜单" });
    expect(menu).toHaveClass(
      "rounded-[var(--radius-panel)]",
      "bg-[var(--bg-raised)]",
      "p-[var(--space-1)]",
    );

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveClass(
      "h-[var(--h-row)]",
      "enabled:hover:bg-[var(--bg-active)]",
    );
    expect(items.every((item) => item.querySelector("svg") !== null)).toBe(
      true,
    );
    expect(items[6]).toBeDisabled();
  });

  it("closes and invokes the selected action", () => {
    const actions = renderMenu(false);

    fireEvent.click(screen.getByRole("menuitem", { name: "复制路径" }));

    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(actions.onCopyPath).toHaveBeenCalledOnce();
  });
});
