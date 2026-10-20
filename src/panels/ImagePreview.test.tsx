import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImagePreview } from "./ImagePreview";

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
});
