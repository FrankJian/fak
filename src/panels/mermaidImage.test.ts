import { afterEach, describe, expect, it, vi } from "vitest";
import { mermaidPngSize, mermaidSvgToPng, serializeMermaidSvg } from "./mermaidImage";

function diagramSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 400 200");
  svg.innerHTML = '<text x="10" y="20">Hello</text>';
  return svg;
}

describe("Mermaid image conversion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serializes a standalone SVG with its namespace and content", () => {
    const result = serializeMermaidSvg(diagramSvg());
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain("Hello");
  });

  it("rasterizes at 2x while limiting oversized canvases", () => {
    expect(mermaidPngSize(diagramSvg())).toEqual({ width: 800, height: 400 });
    const large = diagramSvg();
    large.setAttribute("viewBox", "0 0 10000 5000");
    const size = mermaidPngSize(large);
    expect(size.width).toBeLessThanOrEqual(8192);
    expect(size.height).toBeLessThanOrEqual(8192);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
  });

  it("encodes PNG bytes and releases the temporary SVG URL", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:mermaid-test",
      revokeObjectURL,
    });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(Object.assign(new Blob(), {
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      }));
    });

    expect(await mermaidSvgToPng(diagramSvg())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(drawImage).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mermaid-test");
  });
});
