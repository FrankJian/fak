import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProblemBanner } from "./ProblemBanner";

describe("ProblemBanner", () => {
  it("reveals a stable diagnostic code and opens the log directory on demand", async () => {
    const onOpenLogs = vi.fn();
    render(
      <ProblemBanner
        problem={{ code: "binaryContent", title: "二进制文件", next: "请重试" }}
        onDismiss={vi.fn()}
        onOpenLogs={onOpenLogs}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看错误详情" }));
    expect(screen.getByText("错误代码：binaryContent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开日志目录" }));
    expect(onOpenLogs).toHaveBeenCalledOnce();
  });
});
