import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import { FileTreePanel } from "./FileTreePanel";

describe("FileTreePanel resize", () => {
  it("captures a drag on a usable separator and persists the resulting width", () => {
    const patchConfig = vi.fn();
    useAppStore.setState({ fileTreeWidth: 260, patchConfig });
    render(
      <FileTreePanel
        root={null}
        loadingPath={null}
        activePath={null}
        onOpenFile={vi.fn()}
        onToggle={vi.fn()}
        onRefresh={vi.fn()}
        onCollapseAll={vi.fn()}
        onRename={vi.fn()}
        onMoveToTrash={vi.fn()}
        onPermanentlyDelete={vi.fn()}
        onCopyText={vi.fn()}
        onReveal={vi.fn()}
        onError={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const separator = screen.getByRole("separator", { name: /调整文件树宽度/ });
    const capture = vi.fn();
    separator.setPointerCapture = capture;
    separator.releasePointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn().mockReturnValue(true);

    fireEvent.pointerDown(separator, { button: 0, pointerId: 7, clientX: 260 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(separator).toHaveClass("w-[8px]");
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 340 });
    expect(screen.getByRole("complementary", { name: "文件树" })).toHaveStyle({ width: "340px" });
    fireEvent.pointerUp(separator, { pointerId: 7 });
    expect(patchConfig).toHaveBeenCalledWith({ fileTreeWidth: 340 });
  });
});
