import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauriAvailable } from "../ipc/invoke";
import { restoreSession } from "../ipc/session";
import { useAppStore } from "../store/appStore";
import { useDocumentStore } from "../store/documentStore";
import type { WorkspaceState } from "./useWorkspace";
import { useSession } from "./useSession";

vi.mock("../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/invoke")>()),
  isTauriAvailable: vi.fn(),
}));

vi.mock("../ipc/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/session")>()),
  restoreSession: vi.fn(),
  saveSession: vi.fn(),
}));

describe("useSession", () => {
  beforeEach(() => {
    useDocumentStore.setState({ tabs: [], activeId: null });
    useAppStore.setState({ hydrated: true, restoreLastSession: true });
    vi.mocked(isTauriAvailable).mockReturnValue(true);
    vi.mocked(restoreSession).mockReset();
  });

  it("cancels a delayed restore so closed tabs cannot return after refreshing the file tree", async () => {
    let resolveRestore: (value: Awaited<ReturnType<typeof restoreSession>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof restoreSession>>>(
      (resolve) => {
        resolveRestore = resolve;
      },
    );
    vi.mocked(restoreSession).mockReturnValue(pending);
    const workspace = {
      adopt: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      handleRef: { current: null },
    } as unknown as WorkspaceState;
    const restoreViewState = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useSession({
        workspace,
        hasPendingBackups: false,
        getViewState: () => ({
          workspaceRoot: null,
          expandedPaths: [],
          fileTreeOpen: false,
          bookmarkPanelOpen: false,
          outlinePanelOpen: false,
          markdownPreviewMode: "hidden",
        }),
        restoreViewState,
      }),
    );

    await waitFor(() => expect(restoreSession).toHaveBeenCalledOnce());
    act(() => result.current.cancelPendingRestore());
    resolveRestore!({
      documents: [
        {
          meta: {
            documentId: "restored-note",
            fileName: "note.md",
            mode: "full",
            sizeBytes: 1,
            lineCount: 1,
            maxLineLen: 1,
            encoding: "UTF-8",
            encodingConfidence: "high",
            lineEnding: "lf",
            documentVersion: 0,
            dirty: false,
            readOnly: false,
            looksBinary: false,
          },
          line: 0,
          topLine: 0,
          active: true,
          foldedLines: [],
          locked: false,
        },
      ],
      missing: 0,
      view: {
        workspaceRoot: null,
        expandedPaths: [],
        fileTreeOpen: false,
        bookmarkPanelOpen: false,
        outlinePanelOpen: false,
        markdownPreviewMode: "hidden",
      },
    });

    await waitFor(() =>
      expect(workspace.close).toHaveBeenCalledWith("restored-note"),
    );
    expect(workspace.adopt).not.toHaveBeenCalled();
    expect(restoreViewState).not.toHaveBeenCalled();
  });
});
