import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutSection } from "./AboutSection";

describe("AboutSection", () => {
  it("在应用名称旁显示应用图标", () => {
    const { container } = render(
      <AboutSection onCheckForUpdates={vi.fn()} />,
    );

    const icon = container.querySelector("img");
    expect(icon?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(icon).toHaveAttribute("alt", "");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Fak")).toBeInTheDocument();
  });
});
