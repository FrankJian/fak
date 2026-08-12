import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "../editor/useEditorView";
import type { SearchStarted } from "../ipc/search";
import { SEARCH_DEBOUNCE_MS, useFindReplace } from "./useFindReplace";

const search = vi.hoisted(() => ({
  start: vi.fn(),
  startResultFilter: vi.fn(),
  dispose: vi.fn(),
  cancel: vi.fn(),
  plan: vi.fn(),
  step: vi.fn(),
}));

vi.mock("../ipc/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/search")>()),
  startSearch: search.start,
  startResultFilter: search.startResultFilter,
  disposeSearch: search.dispose,
  cancelSearch: search.cancel,
  planReplaceAll: search.plan,
  stepSearch: search.step,
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
    revealRange: vi.fn(),
    applyReplacements: vi.fn(),
  } as Pick<
    EditorHandle,
    | "getText"
    | "getCursor"
    | "getSelection"
    | "showMatches"
    | "revealRange"
    | "applyReplacements"
  >,
} as React.RefObject<EditorHandle | null>;

describe("useFindReplace session restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.start.mockImplementation((documentId: string) =>
      Promise.resolve(started(documentId)),
    );
    search.plan.mockResolvedValue([{ start: 0, end: 6, insert: "done" }]);
    search.step.mockResolvedValue(null);
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

  it("replaces a filtered match and discards the stale filtered session", async () => {
    search.start
      .mockReset()
      .mockResolvedValueOnce(started("document-a"))
      .mockResolvedValueOnce({
        sessionId: "session-after-replace",
        total: 0,
        documentVersion: 2,
        firstPage: [],
        positions: [],
      } satisfies SearchStarted);
    search.startResultFilter
      .mockResolvedValueOnce({
        ...started("filtered"),
        sessionId: "session-filtered-before-replace",
      })
      .mockResolvedValueOnce({
        sessionId: "session-filtered-after-replace",
        total: 0,
        documentVersion: 2,
        firstPage: [],
        positions: [],
      } satisfies SearchStarted);

    const { result, rerender } = renderHook(
      ({ contentRevision }) =>
        useFindReplace({
          documentId: "document-a",
          handleRef,
          open: true,
          contentRevision,
        }),
      { initialProps: { contentRevision: 0 } },
    );
    act(() => {
      result.current.setState((state) => ({
        ...state,
        query: "needle",
        resultFilter: "document",
      }));
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => result.current.goTo(0));
    await waitFor(() => expect(result.current.current).toBe(0));
    await act(async () => result.current.replaceCurrent());

    await waitFor(() => expect(result.current.rows).toEqual([]));
    rerender({ contentRevision: 1 });
    await act(
      () =>
        new Promise((resolve) =>
          setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50),
        ),
    );
    expect(search.start).toHaveBeenCalledTimes(2);
    expect(search.startResultFilter).toHaveBeenCalledTimes(2);
  });

  it("discards filtered results when the document content changes", async () => {
    search.start
      .mockReset()
      .mockResolvedValueOnce(started("document-a"))
      .mockResolvedValueOnce({
        sessionId: "session-after-edit",
        total: 0,
        documentVersion: 2,
        firstPage: [],
        positions: [],
      } satisfies SearchStarted);
    search.startResultFilter
      .mockResolvedValueOnce({
        ...started("filtered"),
        sessionId: "session-filtered-before-edit",
      })
      .mockResolvedValueOnce({
        sessionId: "session-filtered-after-edit",
        total: 0,
        documentVersion: 2,
        firstPage: [],
        positions: [],
      } satisfies SearchStarted);

    const { result, rerender } = renderHook(
      ({ contentRevision }) =>
        useFindReplace({
          documentId: "document-a",
          handleRef,
          open: true,
          contentRevision,
        }),
      { initialProps: { contentRevision: 0 } },
    );
    act(() => {
      result.current.setState((state) => ({
        ...state,
        query: "needle",
        resultFilter: "document",
      }));
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    rerender({ contentRevision: 1 });

    await waitFor(() => expect(result.current.rows).toEqual([]));
    await waitFor(() => expect(search.start).toHaveBeenCalledTimes(2));
    expect(search.startResultFilter).toHaveBeenCalledTimes(2);
    expect(search.dispose).toHaveBeenCalledWith(
      "session-filtered-before-edit",
    );
  });
});
