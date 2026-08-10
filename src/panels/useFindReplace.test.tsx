import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "../editor/useEditorView";
import type { SearchStarted } from "../ipc/search";
import { useFindReplace } from "./useFindReplace";

const search = vi.hoisted(() => ({
  start: vi.fn(),
  startResultFilter: vi.fn(),
  dispose: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../ipc/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/search")>()),
  startSearch: search.start,
  startResultFilter: search.startResultFilter,
  disposeSearch: search.dispose,
  cancelSearch: search.cancel,
}));

function started(documentId: string): SearchStarted {
  return {
    sessionId: `session-${documentId}`,
    total: 1,
    documentVersion: 1,
    firstPage: [
      {
        start: 0,
        end: 6,
        line: 0,
        preview: `${documentId} needle`,
        previewStart: 0,
        previewEnd: 6,
        secondaryRanges: [],
      },
    ],
    positions: [{ start: 0, end: 6, line: 0 }],
  };
}

const handleRef = {
  current: {
    getText: () => "test document",
    getCursor: () => 0,
    getSelection: () => ({ from: 0, to: 0 }),
    showMatches: vi.fn(),
  } as Pick<
    EditorHandle,
    "getText" | "getCursor" | "getSelection" | "showMatches"
  >,
} as React.RefObject<EditorHandle | null>;

describe("useFindReplace session restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.start.mockImplementation((documentId: string) =>
      Promise.resolve(started(documentId)),
    );
  });

  it("restores a document's matching cached search when switching back", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ documentId }) => useFindReplace({ documentId, handleRef, open: true }),
      { initialProps: { documentId: "document-a" as string | null } },
    );

    act(() => {
      result.current.setState((state) => ({ ...state, query: "needle" }));
    });
    await waitFor(() => expect(search.start).toHaveBeenCalledTimes(1));

    rerender({ documentId: "document-b" });
    await waitFor(() => expect(search.start).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.rows[0]?.preview).toBe("document-b needle"),
    );

    rerender({ documentId: "document-a" });
    await waitFor(() =>
      expect(result.current.rows[0]?.preview).toBe("document-a needle"),
    );
    expect(search.start).toHaveBeenCalledTimes(2);
    expect(search.dispose).not.toHaveBeenCalled();

    unmount();
    expect(search.dispose).toHaveBeenCalledWith("session-document-a");
    expect(search.dispose).toHaveBeenCalledWith("session-document-b");
  });

  it("derives a result-filter session and shows its secondary highlights", async () => {
    search.startResultFilter.mockResolvedValue({
      ...started("filtered"),
      sessionId: "session-filtered",
      firstPage: [
        {
          ...started("filtered").firstPage[0],
          preview: "filtered needle alpha",
          secondaryRanges: [{ start: 16, end: 21 }],
        },
      ],
    } satisfies SearchStarted);
    const { result } = renderHook(() =>
      useFindReplace({ documentId: "document-a", handleRef, open: true }),
    );

    act(() => {
      result.current.setState((state) => ({ ...state, query: "needle" }));
    });
    await waitFor(() => expect(search.start).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setState((state) => ({ ...state, resultFilter: "alpha" }));
    });
    await waitFor(() =>
      expect(search.startResultFilter).toHaveBeenCalledWith(
        "session-document-a",
        "alpha",
        false,
      ),
    );
    await waitFor(() =>
      expect(result.current.rows[0]?.preview).toBe("filtered needle alpha"),
    );
    expect(search.dispose).toHaveBeenCalledWith("session-document-a");
  });

  it("passes escape parsing to search when replace mode is open", async () => {
    const { result } = renderHook(() =>
      useFindReplace({
        documentId: "document-a",
        handleRef,
        open: true,
        parseEscapes: true,
      }),
    );

    act(() => {
      result.current.setState((state) => ({ ...state, query: "\\n" }));
    });

    await waitFor(() =>
      expect(search.start).toHaveBeenCalledWith(
        "document-a",
        "\\n",
        expect.objectContaining({ parseEscapes: true }),
        undefined,
      ),
    );
  });
});
