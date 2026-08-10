// @ts-expect-error Vitest 在 Node 中运行 CSS 守卫；前端产物刻意不引入 Node 类型。
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "./Minimap";

afterEach(() => vi.restoreAllMocks());

describe("Minimap layout", () => {
  it("leaves the native vertical scrollbar on its right", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    render(
      <Minimap
        totalLines={20}
        topLine={0}
        visibleLines={10}
        density={[]}
        matches={[]}
        changes={[]}
        autohide={false}
        onSeek={vi.fn()}
      />,
    );

    const minimap = screen.getByRole("slider", { name: "小地图" });
    const layer = minimap.parentElement;
    expect(layer).toHaveClass(
      "absolute",
      "right-[var(--w-scrollbar)]",
      "h-full",
      "bg-[var(--bg-base)]",
    );
    expect(layer).toHaveStyle({
      width: "var(--w-minimap)",
    });
    expect(minimap).toHaveClass("h-full", "w-full");
  });

  it("keeps the minimap area opaque while its drawing is auto-hidden", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    render(
      <Minimap
        totalLines={20}
        topLine={0}
        visibleLines={10}
        density={[]}
        matches={[]}
        changes={[]}
        autohide
        onSeek={vi.fn()}
      />,
    );

    const minimap = screen.getByRole("slider", { name: "小地图" });
    expect(minimap).toHaveStyle({ opacity: "0" });
    expect(minimap.parentElement).toHaveClass("bg-[var(--bg-base)]");
  });

  it("reserves the minimap width inside CodeMirror without moving its scrollbar", () => {
    const css = readFileSync("src/design/base.css", "utf8");

    expect(css).toMatch(
      /\.editor-with-minimap \.cm-scroller\s*\{[^}]*padding-right:\s*var\(--w-minimap\)/s,
    );
  });
});
