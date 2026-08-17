import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenRequests } from "./useOpenRequests";

const mocks = vi.hoisted(() => ({
  takeStartupPaths: vi.fn<() => Promise<string[]>>(),
  listenOpenPaths: vi.fn(),
  listenDroppedPaths: vi.fn(),
  openHandler: null as (() => void) | null,
  droppedHandler: null as ((paths: string[]) => void) | null,
}));

vi.mock("../ipc/startup", () => ({
  takeStartupPaths: mocks.takeStartupPaths,
  listenOpenPaths: mocks.listenOpenPaths,
}));

vi.mock("../ipc/window", () => ({
  listenDroppedPaths: mocks.listenDroppedPaths,
}));

describe("useOpenRequests", () => {
  beforeEach(() => {
    mocks.takeStartupPaths.mockReset().mockResolvedValue([]);
    mocks.listenOpenPaths.mockReset().mockImplementation((handler) => {
      mocks.openHandler = handler;
      return Promise.resolve(() => {
        if (mocks.openHandler === handler) mocks.openHandler = null;
      });
    });
    mocks.listenDroppedPaths.mockReset().mockImplementation((handler) => {
      mocks.droppedHandler = handler;
      return Promise.resolve(() => {});
    });
    mocks.openHandler = null;
    mocks.droppedHandler = null;
  });

  it("按拖入顺序打开窗口中放下的多个文件", async () => {
    const open = vi.fn<(path: string) => Promise<void>>().mockResolvedValue();
    renderHook(() => useOpenRequests(open));

    await waitFor(() => expect(mocks.listenDroppedPaths).toHaveBeenCalledOnce());
    act(() => mocks.droppedHandler?.(["/tmp/one.txt", "/tmp/two.md"]));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls.map(([path]) => path)).toEqual([
      "/tmp/one.txt",
      "/tmp/two.md",
    ]);
  });

  it("先建立系统事件监听，再排空冷启动路径", async () => {
    const open = vi.fn<(path: string) => Promise<void>>().mockResolvedValue();
    mocks.takeStartupPaths.mockImplementation(async () => {
      expect(mocks.openHandler).not.toBeNull();
      return ["/tmp/cold-start.txt"];
    });

    renderHook(() => useOpenRequests(open));

    await waitFor(() => expect(open).toHaveBeenCalledWith("/tmp/cold-start.txt"));
  });

  it("打开回调变化时不重建监听，也不会丢掉已取出的启动路径", async () => {
    let resolveStartup: ((paths: string[]) => void) | null = null;
    mocks.takeStartupPaths.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveStartup = resolve;
      }),
    );
    const firstOpen = vi
      .fn<(path: string) => Promise<void>>()
      .mockResolvedValue();
    const latestOpen = vi
      .fn<(path: string) => Promise<void>>()
      .mockResolvedValue();

    const { rerender } = renderHook(
      ({ open }) => useOpenRequests(open),
      { initialProps: { open: firstOpen } },
    );
    await waitFor(() => expect(mocks.takeStartupPaths).toHaveBeenCalledOnce());

    rerender({ open: latestOpen });
    act(() => resolveStartup?.(["/tmp/from-double-click.md"]));

    await waitFor(() =>
      expect(latestOpen).toHaveBeenCalledWith("/tmp/from-double-click.md"),
    );
    expect(firstOpen).not.toHaveBeenCalled();
    expect(mocks.listenOpenPaths).toHaveBeenCalledOnce();
    expect(mocks.takeStartupPaths).toHaveBeenCalledOnce();
  });

  it("系统事件到达后从后端队列排空路径", async () => {
    const open = vi.fn<(path: string) => Promise<void>>().mockResolvedValue();
    mocks.takeStartupPaths
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["/tmp/reopened.txt"]);

    renderHook(() => useOpenRequests(open));
    await waitFor(() => expect(mocks.takeStartupPaths).toHaveBeenCalledOnce());

    act(() => mocks.openHandler?.());

    await waitFor(() => expect(open).toHaveBeenCalledWith("/tmp/reopened.txt"));
    expect(mocks.takeStartupPaths).toHaveBeenCalledTimes(2);
  });
});
