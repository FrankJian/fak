import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEARCH_OPTIONS } from "../ipc/search";
import { FindPanel } from "./FindPanel";
import { INITIAL_PATH_SCOPE, type usePathSearch } from "./usePathSearch";
import {
  INITIAL_FIND_STATE,
  type FindState,
  type FindStatus,
  type useFindReplace,
} from "./useFindReplace";

function findState(): ReturnType<typeof useFindReplace> {
  const state: FindState = {
    ...INITIAL_FIND_STATE,
    query: "needle",
    resultFilter: "missing",
    options: { ...DEFAULT_SEARCH_OPTIONS },
  };
  const status: FindStatus = {
    total: 0,
    searching: false,
    problem: null,
    pendingReplaceCount: null,
  };

  return {
    state,
    setState: vi.fn(),
    findHistory: [],
    replaceHistory: [],
    findReverse: false,
    rememberFind: vi.fn(),
    clearFindHistory: vi.fn(),
    clearReplaceHistory: vi.fn(),
    toggleFindReverse: vi.fn(),
    status,
    showProgress: false,
    current: -1,
    rows: [],
    positions: [],
    overviewLength: 0,
    loadMore: vi.fn(),
    step: vi.fn(),
    stop: vi.fn(),
    goTo: vi.fn(),
    replaceCurrent: vi.fn(),
    replaceAll: vi.fn(),
    confirmReplaceAll: vi.fn(),
    cancelReplaceAll: vi.fn(),
  };
}

/** 跨文件那一半在这组用例里不参与，给一份空会话即可。 */
function pathSearchState() {
  return {
    state: INITIAL_PATH_SCOPE,
    setState: vi.fn(),
    request: null,
    rows: [],
    visibleRows: [],
    groups: [],
    total: 0,
    loaded: 0,
    scannedFiles: 0,
    skipped: [],
    truncated: false,
    searching: false,
    showProgress: false,
    problem: null,
    resultFilter: "",
    setResultFilter: vi.fn(),
    loadMore: vi.fn(),
    stop: vi.fn(),
    pageSize: 200,
  } as unknown as ReturnType<typeof usePathSearch>;
}

const crossFileProps = {
  scope: "document" as const,
  onScopeChange: vi.fn(),
  workspaceRoot: null,
  onPickPathRow: vi.fn(),
  onReplaceAcrossFiles: vi.fn(),
};

describe("FindPanel", () => {
  it("keeps the result filter available when it has zero matching rows", () => {
    render(
      <FindPanel
        find={findState()}
        pathSearch={pathSearchState()}
        {...crossFileProps}
        showReplace={false}
        onToggleReplace={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("missing")).toBeInTheDocument();
  });

  it("uses the reverse direction for Enter by default", () => {
    const find = findState();
    find.findReverse = true;
    render(
      <FindPanel
        find={find}
        pathSearch={pathSearchState()}
        {...crossFileProps}
        showReplace={false}
        onToggleReplace={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByDisplayValue("needle"), { key: "Enter" });

    expect(find.step).toHaveBeenCalledWith(false);
  });
});
