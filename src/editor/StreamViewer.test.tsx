import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentMeta } from "../ipc/documents";
import { StreamViewer } from "./StreamViewer";

const mocks = vi.hoisted(() => ({
  readLines: vi.fn(),
  noteScroll: vi.fn(),
}));

vi.mock("../ipc/documents", () => ({ readLines: mocks.readLines }));
vi.mock("../i18n/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../store/appStore", () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({ minimap: false, minimapAutohide: false }),
}));
vi.mock("./StreamToolbar", () => ({
  StreamToolbar: () => <div />,
}));
vi.mock("./StreamFindBar", () => ({
  StreamFindBar: () => <div />,
}));
vi.mock("../panels/StreamReplaceDialog", () => ({
  StreamReplaceDialog: () => <div />,
}));
vi.mock("./useStreamFind", () => ({
  useStreamFind: () => ({
    query: "",
    options: {},
    matches: [],
    current: -1,
  }),
}));
vi.mock("./useTailFollow", () => ({
  BOTTOM_SLACK_PX: 4,
  useTailFollow: () => ({
    following: false,
    paused: false,
    pendingLines: 0,
    truncated: false,
    lineCount: 100,
    setEnabled: vi.fn(),
    noteScroll: mocks.noteScroll,
    resume: vi.fn(),
  }),
}));

const META: DocumentMeta = {
  documentId: "stream-1",
  fileName: "large.log",
  mode: "stream",
  sizeBytes: 1024,
  lineCount: 100,
  maxLineLen: 20,
  encoding: "UTF-8",
  encodingConfidence: "high",
  lineEnding: "lf",
  documentVersion: 0,
  dirty: false,
  readOnly: true,
  looksBinary: false,
};

beforeEach(() => {
  mocks.readLines.mockResolvedValue({
    start: 0,
    lines: [],
    totalLines: 100,
    truncated: false,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StreamViewer scrolling", () => {
  it("coalesces repeated scroll events into one animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<StreamViewer meta={META} onPromote={vi.fn()} />);
    const viewport = screen.getByLabelText("stream.content");

    fireEvent.scroll(viewport);
    fireEvent.scroll(viewport);
    fireEvent.scroll(viewport);

    expect(frames).toHaveLength(1);
    expect(mocks.noteScroll).not.toHaveBeenCalled();

    act(() => frames[0](16));
    expect(mocks.noteScroll).toHaveBeenCalledTimes(1);
  });
});
