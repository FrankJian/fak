import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OutlineNode } from "../ipc/outline";
import { StickyHeader } from "./StickyHeader";

const heading = {
  name: "实施任务",
  kind: "heading",
  depth: 0,
  line: 0,
  start: 0,
  end: 4,
} as OutlineNode;

describe("StickyHeader", () => {
  it("starts after the complete gutter instead of covering line numbers", () => {
    render(
      <StickyHeader
        chain={[heading]}
        onPick={vi.fn()}
        gutterWidth={84}
        topLine={1}
      />,
    );

    const header = screen.getByLabelText("所在结构");
    expect(header).toHaveStyle({ left: "84px" });
    expect(header).toHaveClass("right-0");
    expect(header).not.toHaveClass("inset-x-0");
  });

  it("does not duplicate a heading that is still visible in the viewport", () => {
    render(
      <StickyHeader
        chain={[heading]}
        onPick={vi.fn()}
        gutterWidth={84}
        topLine={0}
      />,
    );

    expect(screen.queryByLabelText("所在结构")).not.toBeInTheDocument();
  });
});
