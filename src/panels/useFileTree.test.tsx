import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listDirectory,
  moveWorkspaceEntryToTrash,
  permanentlyDeleteWorkspaceEntry,
} from "../ipc/workspace";
import { useDocumentStore } from "../store/documentStore";
import { useFileTree } from "./useFileTree";

vi.mock("../ipc/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/workspace")>()),
  listDirectory: vi.fn(),
  moveWorkspaceEntryToTrash: vi.fn(),
  permanentlyDeleteWorkspaceEntry: vi.fn(),
  onWorkspaceDirectoryChanged: vi.fn(() => () => {}),
}));

describe("useFileTree deletion", () => {
  beforeEach(() => {
    useDocumentStore.setState({ tabs: [], activeId: null });
    vi.mocked(listDirectory).mockReset();
    vi.mocked(listDirectory).mockResolvedValue([]);
    vi.mocked(moveWorkspaceEntryToTrash).mockReset();
    vi.mocked(permanentlyDeleteWorkspaceEntry).mockReset();
  });

  it("closes affected tabs only after the move to trash succeeds", async () => {
    useDocumentStore.setState({
      tabs: [{
        meta: { documentId: "open" }, path: "/work/open.md",
      } as ReturnType<typeof useDocumentStore.getState>["tabs"][number]],
      activeId: "open",
    });
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileTree(vi.fn(), onDeleted));
    await act(async () => result.current.openRoot("/work"));

    vi.mocked(moveWorkspaceEntryToTrash).mockResolvedValueOnce({ outcome: "unavailable", documentIds: [] });
    await act(async () => result.current.moveToTrash("/work/open.md"));
    expect(onDeleted).not.toHaveBeenCalled();

    vi.mocked(moveWorkspaceEntryToTrash).mockRejectedValueOnce(new Error("trash failed"));
    await expect(act(async () => result.current.moveToTrash("/work/open.md")))
      .rejects.toThrow("trash failed");
    expect(onDeleted).not.toHaveBeenCalled();

    vi.mocked(moveWorkspaceEntryToTrash).mockResolvedValueOnce({ outcome: "moved", documentIds: ["open"] });
    await act(async () => result.current.moveToTrash("/work/open.md"));
    expect(onDeleted).toHaveBeenCalledWith(["open"]);
  });

  it("closes restored tabs identified by Rust after permanent deletion", async () => {
    useDocumentStore.setState({
      tabs: [{
        meta: { documentId: "restored" }, path: null,
      } as ReturnType<typeof useDocumentStore.getState>["tabs"][number]],
      activeId: "restored",
    });
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileTree(vi.fn(), onDeleted));
    await act(async () => result.current.openRoot("/work"));
    vi.mocked(permanentlyDeleteWorkspaceEntry).mockResolvedValue({ documentIds: ["restored"] });

    await act(async () => result.current.permanentlyDelete("/work/open.md"));
    expect(onDeleted).toHaveBeenCalledWith(["restored"]);
  });
});
