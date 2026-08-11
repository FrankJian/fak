import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenRequests } from "./useOpenRequests";

const mocks = vi.hoisted(() => ({
  takeStartupPaths: vi.fn<() => Promise<string[]>>(),
  listenOpenPaths: vi.fn(),
  listenDroppedPaths: vi.fn(),
  openHandler: null as ((paths: string[]) => void) | null,
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
    mocks.listenOpenPaths.mockReset().mockResolvedValue(() => {});
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

  it("不会丢失前端挂载期间到达的打开请求", async () => {
    const open = vi.fn<(path: string) => Promise<void>>().mockResolvedValue();

    mocks.listenOpenPaths.mockImplementation(
      (handler: (paths: string[]) => void) =>
        Promise.resolve().then(() => {
          mocks.openHandler = handler;
          return () => {
            if (mocks.openHandler === handler) mocks.openHandler = null;
          };
        }),
    );
    mocks.takeStartupPaths.mockImplementation(async () => {
      await Promise.resolve();
      mocks.openHandler?.(["/tmp/reopened.txt"]);
      return [];
    });

    renderHook(() => useOpenRequests(open));

    await waitFor(() => expect(open).toHaveBeenCalledWith("/tmp/reopened.txt"));
  });
});
