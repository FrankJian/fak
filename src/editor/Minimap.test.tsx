// @ts-expect-error Vitest 在 Node 中运行 CSS 守卫；前端产物刻意不引入 Node 类型。
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Minimap } from "./Minimap";

afterEach(() => vi.restoreAllMocks());

describe("Minimap layout", () => {
  it("leaves the native vertical scrollbar on its right", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    render(
      <Minimap
        totalLines={20}
        scrollProgress={0}
        viewportFraction={0.5}
        density={[]}
        matches={[]}
        changes={[]}
        autohide={false}
        onScrollProgress={vi.fn()}
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
        scrollProgress={0}
        viewportFraction={0.5}
        density={[]}
        matches={[]}
        changes={[]}
        autohide
        onScrollProgress={vi.fn()}
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

  it("drags by scroll percentage without seeking a document line", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onScrollProgress = vi.fn();
    render(
      <Minimap
        totalLines={10_000}
        scrollProgress={0}
        viewportFraction={0.2}
        density={[]}
        matches={[]}
        changes={[]}
        autohide={false}
        onScrollProgress={onScrollProgress}
      />,
    );

    const minimap = screen.getByRole("slider", { name: "小地图" });
    vi.spyOn(minimap, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    Object.assign(minimap, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(minimap, { pointerId: 1, clientY: 10 });
    fireEvent.pointerMove(minimap, { pointerId: 1, clientY: 90 });

    expect(onScrollProgress).toHaveBeenLastCalledWith(1);
  });
});
