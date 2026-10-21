import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clampImageZoom, ImagePreview } from "./ImagePreview";

vi.mock("../ipc/assets", () => ({
  assetUrl: (path: string) => `asset:${path}`,
}));

describe("ImagePreview", () => {
  it("renders an image through the local asset URL", () => {
    render(<ImagePreview path="/work/diagram.png" fileName="diagram.png" />);
    expect(screen.getByRole("img", { name: "diagram.png" })).toHaveAttribute(
      "src",
      "asset:/work/diagram.png",
    );
  });

  it("shows a clear fallback when the WebView cannot decode the image", () => {
    render(<ImagePreview path="/work/diagram.png" fileName="diagram.png" />);
    fireEvent.error(screen.getByRole("img", { name: "diagram.png" }));
    expect(screen.getByText("无法显示此图片。文件可能已损坏或该格式不受系统 WebView 支持。"))
      .toBeInTheDocument();
  });

  it("offers zoom controls and resets the displayed percentage", () => {
    render(<ImagePreview path="/work/diagram.png" fileName="diagram.png" />);
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByRole("button", { name: "恢复默认缩放" })).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认缩放" }));
    expect(screen.getByRole("button", { name: "恢复默认缩放" })).toHaveTextContent("100%");
  });

  it("keeps zoom within the supported range", () => {
    expect(clampImageZoom(0)).toBe(0.25);
    expect(clampImageZoom(9)).toBe(4);
  });
});
