import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardBackup } from "../ipc/backup";
import { pickPathToSave } from "../ipc/dialog";
import {
  readAllText,
  redo as redoDocument,
  saveDocument,
  undo as undoDocument,
  type DocumentMeta,
} from "../ipc/documents";
import type { EditorHandle } from "../editor/useEditorView";
import { useAppStore } from "../store/appStore";
import { useDocumentStore } from "../store/documentStore";
import { useWorkspace } from "./useWorkspace";

vi.mock("../ipc/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc/documents")>();
  return {
    ...actual,
    readAllText: vi.fn(),
    saveDocument: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
});

vi.mock("../ipc/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/dialog")>()),
  pickPathToSave: vi.fn(),
}));

vi.mock("../ipc/backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/backup")>()),
  discardBackup: vi.fn(),
}));

function meta(documentId: string, fileName: string): DocumentMeta {
  return {
    documentId,
    fileName,
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
  };
}

describe("useWorkspace 标签正文", () => {
  beforeEach(() => {
    useDocumentStore.setState({ tabs: [], activeId: null });
    vi.mocked(readAllText).mockReset();
    vi.mocked(readAllText).mockImplementation(async (documentId) =>
      documentId === "app-js" ? "console.log('app');" : '{"pages":[]}',
    );
    vi.mocked(saveDocument).mockReset();
    vi.mocked(undoDocument).mockReset();
    vi.mocked(redoDocument).mockReset();
    vi.mocked(pickPathToSave).mockReset();
    vi.mocked(discardBackup).mockReset();
    vi.mocked(discardBackup).mockResolvedValue(undefined);
    useAppStore.setState({ patchConfig: vi.fn() });
  });

  it("切回旧标签时重新读取该文档，而不是沿用最后打开文件的正文", async () => {
    const { result } = renderHook(() => useWorkspace());

    await act(async () => result.current.adopt(meta("app-js", "app.js")));
    await act(async () =>
      result.current.adopt(meta("app-json", "app.json")),
    );
    expect(result.current.text).toBe('{"pages":[]}');

    act(() => useDocumentStore.getState().activate("app-js"));

    await waitFor(() => expect(result.current.text).toBe("console.log('app');"));
  });

  it("另存为后让当前标签指向新路径，后续保存不再写回源文件", async () => {
    const source = meta("app-json", "source.json");
    useDocumentStore.setState({
      tabs: [
        {
          meta: source,
          syncStatus: "idle",
          lastActiveAt: 1,
          path: "/work/source.json",
          viewportAnchor: { line: 0, topLine: 0 },
          locked: false,
          foldedLines: [],
        },
      ],
      activeId: source.documentId,
    });
    vi.mocked(pickPathToSave).mockResolvedValue("/work/copy.json");
    vi.mocked(saveDocument).mockResolvedValue({
      ...source,
      fileName: "copy.json",
    });

    const { result } = renderHook(() => useWorkspace());
    let saved = false;
    await act(async () => {
      saved = await result.current.saveAs();
    });

    expect(saved).toBe(true);
    expect(pickPathToSave).toHaveBeenCalledWith("/work/source.json");
    expect(saveDocument).toHaveBeenCalledWith("app-json", {
      path: "/work/copy.json",
    });
    expect(discardBackup).toHaveBeenCalledWith("app-json");
    expect(useDocumentStore.getState().tabs[0]).toMatchObject({
      path: "/work/copy.json",
      meta: { fileName: "copy.json" },
    });

    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toBe(true);
    expect(saveDocument).toHaveBeenNthCalledWith(2, "app-json", {
      path: undefined,
    });
  });

  it("撤销前先同步编辑器，避免 Markdown 工具栏编辑仍在合并窗口中", async () => {
    const document = meta("markdown", "notes.md");
    useDocumentStore.setState({
      tabs: [
        {
          meta: document,
          syncStatus: "pending",
          lastActiveAt: 1,
          path: "/work/notes.md",
          viewportAnchor: { line: 0, topLine: 0 },
          locked: false,
          foldedLines: [],
        },
      ],
      activeId: document.documentId,
    });
    const calls: string[] = [];
    const flush = vi.fn(async () => {
      calls.push("flush");
    });
    vi.mocked(undoDocument).mockImplementation(async () => {
      calls.push("undo");
      return {
        applied: false,
        documentVersion: 0,
        dirty: false,
        canUndo: false,
        canRedo: false,
      };
    });

    const { result } = renderHook(() => useWorkspace());
    result.current.handleRef.current = { flush } as unknown as EditorHandle;
    await act(async () => result.current.undo());

    expect(calls).toEqual(["flush", "undo"]);
  });
});
