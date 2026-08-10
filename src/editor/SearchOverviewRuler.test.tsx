import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchMatch } from "../ipc/search";
import { SearchOverviewRuler } from "./SearchOverviewRuler";

function matches(count: number): SearchMatch[] {
  return Array.from({ length: count }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 1,
    line: index,
  }));
}

describe("SearchOverviewRuler", () => {
  it("does not render without searchable positions", () => {
    const { container, rerender } = render(
      <SearchOverviewRuler matches={[]} documentLength={100} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SearchOverviewRuler matches={matches(1)} documentLength={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("downsamples dense results before rendering marks", () => {
    const { container } = render(
      <SearchOverviewRuler matches={matches(501)} documentLength={5_010} />,
    );

    expect(container.querySelectorAll("span")).toHaveLength(251);
    expect(container.querySelector("span")?.style.top).toBe("0%");
  });
});
