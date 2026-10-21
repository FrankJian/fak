import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../ipc/config";
import { applyEdits, type DocumentMeta } from "../ipc/documents";
import type { Appearance } from "./extensions";
import { useEditorView, type EditorHandle } from "./useEditorView";

vi.mock("../ipc/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/documents")>()),
  applyEdits: vi.fn(),
}));

const appearance: Appearance = {
  fontFamily: DEFAULT_CONFIG.fontFamily,
  fontSize: DEFAULT_CONFIG.fontSize,
  lineHeight: DEFAULT_CONFIG.lineHeight,
  letterSpacing: DEFAULT_CONFIG.letterSpacing,
  fontLigatures: DEFAULT_CONFIG.fontLigatures,
  tabWidth: DEFAULT_CONFIG.tabWidth,
  tabIndentMode: DEFAULT_CONFIG.tabIndentMode,
  showLineNumbers: DEFAULT_CONFIG.showLineNumbers,
  highlightCurrentLine: DEFAULT_CONFIG.highlightCurrentLine,
  wordWrap: DEFAULT_CONFIG.wordWrap,
  cursorStyle: DEFAULT_CONFIG.cursorStyle,
  cursorBlink: DEFAULT_CONFIG.cursorBlink,
  rulers: DEFAULT_CONFIG.rulers,
  pasteImageMode: DEFAULT_CONFIG.pasteImageMode,
};

const meta: DocumentMeta = {
  documentId: "history-test",
  fileName: "notes.txt",
  mode: "full",
  sizeBytes: 18,
  lineCount: 3,
  maxLineLen: 6,
  encoding: "UTF-8",
  encodingConfidence: "high",
  lineEnding: "lf",
  documentVersion: 5,
  dirty: true,
  readOnly: false,
  looksBinary: false,
};

function Harness({
  currentMeta,
  handleRef,
}: {
  currentMeta: DocumentMeta;
  handleRef: React.RefObject<EditorHandle | null>;
}) {
  const containerRef = useEditorView({
    meta: currentMeta,
    initialText: "first\nsecond\nthird",
    autoFocus: false,
    appearance,
    longLineWarningLabel: "Long line",
    handleRef,
  });
  return <div ref={containerRef} />;
}

describe("authoritative undo update", () => {
  it("keeps the editor mounted, restores the cursor, and uses the new version for typing", async () => {
    vi.mocked(applyEdits).mockReset();
    vi.mocked(applyEdits).mockResolvedValue({ documentVersion: 7, dirty: true, mode: "full", lineCount: 3 });
    const handleRef = createRef<EditorHandle>();
    const { container, rerender } = render(<Harness currentMeta={meta} handleRef={handleRef} />);
    const editor = container.querySelector(".cm-editor");
    expect(editor).not.toBeNull();

    act(() => {
      handleRef.current?.applyAuthoritativeText("first\nsecond!\nthird", { anchor: 13, head: 13 }, 6);
    });
    rerender(<Harness currentMeta={{ ...meta, documentVersion: 6 }} handleRef={handleRef} />);
    expect(container.querySelector(".cm-editor")).toBe(editor);
    expect(handleRef.current?.getText()).toBe("first\nsecond!\nthird");
    expect(handleRef.current?.getCursor()).toBe(13);
    expect(applyEdits).not.toHaveBeenCalled();

    act(() => handleRef.current?.setText("first\nsecond!!\nthird"));
    await act(async () => { await handleRef.current?.flush(); });
    expect(vi.mocked(applyEdits).mock.calls[0]?.[1]).toBe(6);

    rerender(<Harness currentMeta={{ ...meta, mode: "lean", documentVersion: 7 }} handleRef={handleRef} />);
    expect(handleRef.current?.getText()).toBe("first\nsecond!!\nthird");
  });
});
