import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsWindow } from "./SettingsWindow";

describe("SettingsWindow", () => {
  it("更新设置显示默认关闭的自动检查开关", () => {
    render(
      <SettingsWindow
        initialGroup="updates"
        onOpenFile={vi.fn()}
        onCheckForUpdates={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("switch", { name: "自动检查更新" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("快捷键配置与其他分组共用侧栏并可直接切换", () => {
    render(
      <SettingsWindow
        initialGroup="shortcuts"
        onOpenFile={vi.fn()}
        onCheckForUpdates={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const shortcuts = screen.getByRole("button", { name: "键盘快捷键" });
    const appearance = screen.getByRole("button", { name: "外观" });
    expect(shortcuts).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("region", { name: "键盘快捷键" }),
    ).toBeInTheDocument();

    fireEvent.click(appearance);

    expect(appearance).toHaveAttribute("aria-current", "true");
    expect(shortcuts).toHaveAttribute("aria-current", "false");
    expect(
      screen.queryByRole("region", { name: "键盘快捷键" }),
    ).not.toBeInTheDocument();
  });
});
