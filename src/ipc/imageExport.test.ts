import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: mocks.writeFile }));
vi.mock("./invoke", () => ({ isTauriAvailable: () => true }));

import { saveMermaidImageFile } from "./imageExport";

describe("saveMermaidImageFile", () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.writeFile.mockReset();
  });

  it("writes binary PNG only to the path selected in the save dialog", async () => {
    mocks.save.mockResolvedValue("/tmp/flow.png");
    const bytes = new Uint8Array([137, 80, 78, 71]);

    expect(await saveMermaidImageFile("flow.png", "png", bytes)).toBe("/tmp/flow.png");
    expect(mocks.save).toHaveBeenCalledWith({
      defaultPath: "flow.png",
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/flow.png", bytes);
  });

  it("rejects a mismatched extension without writing outside the dialog-granted path", async () => {
    mocks.save.mockResolvedValue("/tmp/flow.svg");

    await expect(saveMermaidImageFile("flow.png", "png", new Uint8Array([1])))
      .rejects.toThrow("image extension mismatch");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not write when the user cancels", async () => {
    mocks.save.mockResolvedValue(null);

    expect(await saveMermaidImageFile("flow.svg", "svg", new Uint8Array([1]))).toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
