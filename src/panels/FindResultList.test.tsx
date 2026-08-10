import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MatchRow } from "../ipc/search";
import { FindResultList } from "./FindResultList";

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));

vi.mock("../ipc/clipboard", () => ({ copyToClipboard }));

function rows(count: number): MatchRow[] {
  return Array.from({ length: count }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 5,
    line: index,
    preview: `match ${index}`,
    previewStart: 0,
    previewEnd: 5,
    secondaryRanges: [],
  }));
}

describe("FindResultList", () => {
  it("renders only a scroll window for large result sets", () => {
    const { container } = render(
      <FindResultList
        rows={rows(1000)}
        current={-1}
        total={1000}
        onPick={vi.fn()}
        onReachEnd={vi.fn()}
      />,
    );
    const list = screen.getByRole("list");

    expect(screen.getAllByRole("button")).toHaveLength(30);
    expect(container.textContent).toContain("match 0");
    expect(container.textContent).not.toContain("match 500");

    fireEvent.scroll(list, { target: { scrollTop: 2400 } });

    expect(screen.getAllByRole("button")).toHaveLength(50);
    expect(container.textContent).toContain("match 100");
    expect(container.textContent).not.toContain("match 0");
  });

  it("supports range selection and copying selected previews", () => {
    render(
      <FindResultList
        rows={rows(5)}
        current={-1}
        total={5}
        onPick={vi.fn()}
        onReachEnd={vi.fn()}
      />,
    );
    const results = screen.getAllByRole("button");

    fireEvent.click(results[1]);
    fireEvent.click(results[3], { ctrlKey: true });
    fireEvent.click(results[4], { shiftKey: true });

    expect(results[1]).toHaveAttribute("aria-pressed", "false");
    expect(results[3]).toHaveAttribute("aria-pressed", "true");
    expect(results[4]).toHaveAttribute("aria-pressed", "true");

    fireEvent.contextMenu(results[4], { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem"));

    expect(copyToClipboard).toHaveBeenCalledWith("4\tmatch 3\n5\tmatch 4");
  });
});
