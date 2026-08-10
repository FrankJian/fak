import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("优先显示当前文档的完整路径而不是 basename", () => {
    const currentHeading = {
      name: "config",
      kind: "heading" as const,
      depth: 0,
      line: 0,
      start: 0,
      end: 20,
    };
    render(
      <Breadcrumbs
        fileName="README.md"
        filePath="/Users/alice/project/config/README.md"
        chain={[currentHeading]}
        onPick={vi.fn()}
        loadSiblings={vi.fn().mockResolvedValue([])}
      />,
    );

    const path = screen.getByText("/Users/alice/project/config/README.md");
    expect(path).toBeVisible();
    expect(path).toHaveStyle({ maxWidth: "50%" });
    expect(screen.getByRole("button", { name: "config" })).toBeVisible();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });
});
