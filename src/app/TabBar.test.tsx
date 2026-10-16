import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../ipc/documents";
import type { Tab } from "../store/documentStore";
import { TabBar } from "./TabBar";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

function tab(locked: boolean): Tab {
  return {
    meta: {
      documentId: "doc-1",
      fileName: "main.ts",
      dirty: false,
    } as DocumentMeta,
    syncStatus: "idle",
    lastActiveAt: 1,
    path: null,
    viewportAnchor: { line: 0, topLine: 0 },
    locked,
    foldedLines: [],
  };
}

function renderTabBar(locked: boolean, onQuickClose = vi.fn(), missingOnDisk = false) {
  render(
    <TabBar
      tabs={[{ ...tab(locked), missingOnDisk }]}
      activeId="doc-1"
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onQuickClose={onQuickClose}
      onToggleLock={vi.fn()}
      onCloseOthers={vi.fn()}
      onCloseToRight={vi.fn()}
      onCopyPath={vi.fn()}
      onRevealInFileManager={vi.fn()}
      onSetCompareSource={vi.fn()}
      onCompareWithSource={vi.fn()}
      compareSourceId={null}
      diffTabs={[]}
      activeDiffId={null}
      onActivateDiff={vi.fn()}
      onCloseDiff={vi.fn()}
    />,
  );
  return onQuickClose;
}

describe("locked tab quick close", () => {
  it("ignores middle click when locked", () => {
    const onQuickClose = renderTabBar(true);
    fireEvent(
      screen.getByRole("tab"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onQuickClose).not.toHaveBeenCalled();
  });

  it("uses the quick-close path when unlocked", () => {
    const onQuickClose = renderTabBar(false);
    fireEvent(
      screen.getByRole("tab"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(onQuickClose).toHaveBeenCalledWith("doc-1");
  });
});

describe("deleted file tab", () => {
  it("shows a visible deletion notice while keeping the tab open", () => {
    renderTabBar(false, vi.fn(), true);
    expect(screen.getByRole("tab")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已删除");
  });
});
