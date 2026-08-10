import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "../editor/useEditorView";
import { useTextTools } from "./useTextTools";

const textops = vi.hoisted(() => ({
  planFormat: vi.fn(),
}));

vi.mock("../ipc/textops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/textops")>()),
  planFormat: textops.planFormat,
}));

describe("useTextTools format document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    textops.planFormat.mockResolvedValue([]);
  });

  it("formats the whole document even when the context-menu line is selected", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const getSelection = vi.fn(() => ({ from: 24, to: 41 }));
    const handleRef = {
      current: {
        flush,
        getSelection,
        applyReplacements: vi.fn(),
      } as Pick<
        EditorHandle,
        "flush" | "getSelection" | "applyReplacements"
      >,
    } as React.RefObject<EditorHandle | null>;

    const { result } = renderHook(() =>
      useTextTools({
        documentId: "document-json",
        handleRef,
        onError: vi.fn(),
        tabWidth: 2,
        useTabs: false,
        fileName: "settings.json",
      }),
    );

    act(() => result.current.runFormat("json", false));

    await waitFor(() =>
      expect(textops.planFormat).toHaveBeenCalledWith(
        "document-json",
        "json",
        { minify: false, indentWidth: 2, useTabs: false },
      ),
    );
    expect(flush).toHaveBeenCalledOnce();
    expect(getSelection).not.toHaveBeenCalled();
  });
});
