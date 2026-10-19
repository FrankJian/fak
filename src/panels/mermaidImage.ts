const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_PNG_EDGE = 8192;
const MAX_PNG_PIXELS = 16_000_000;

export function serializeMermaidSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", SVG_NAMESPACE);
  return new XMLSerializer().serializeToString(copy);
}

function sourceSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const rectangle = svg.getBoundingClientRect();
  const width = viewBox?.length === 4 && viewBox[2] > 0
    ? viewBox[2]
    : rectangle.width || 800;
  const height = viewBox?.length === 4 && viewBox[3] > 0
    ? viewBox[3]
    : rectangle.height || 600;
  return { width, height };
}

export function mermaidPngSize(svg: SVGSVGElement): { width: number; height: number } {
  const { width, height } = sourceSize(svg);
  const scale = Math.min(
    2,
    MAX_PNG_EDGE / width,
    MAX_PNG_EDGE / height,
    Math.sqrt(MAX_PNG_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export async function mermaidSvgToPng(svg: SVGSVGElement): Promise<Uint8Array> {
  const source = serializeMermaidSvg(svg);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("SVG image loading failed"));
      image.src = url;
    });
    const size = mermaidPngSize(svg);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    // 与预览的背景一致，避免透明 PNG 在外部查看器的背景上失去对比度。
    const background = getComputedStyle(svg.closest(".markdown-mermaid") ?? svg).backgroundColor;
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("PNG encoding failed"));
      }, "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
