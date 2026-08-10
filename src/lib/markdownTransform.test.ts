import { describe, expect, it } from "vitest";
import { markdownTransform } from "./markdownTransform";

describe("Markdown 工具栏文本变换", () => {
  it("设为正文会去掉各级标题标记", () => {
    const edit = markdownTransform("paragraph", "### 标题", { from: 0, to: 6 });
    expect(edit.insert).toBe("标题");
  });

  it("设为正文是幂等的：已经是正文时不会反过来加标记", () => {
    const once = markdownTransform("paragraph", "正文", { from: 0, to: 2 });
    expect(once.insert).toBe("正文");
  });

  it("设为正文按行处理多行选区", () => {
    const edit = markdownTransform("paragraph", "# 一\n## 二", {
      from: 0,
      to: 7,
    });
    expect(edit.insert).toBe("一\n二");
  });

  it("有选区时包裹，再次执行时取消标记", () => {
    const wrapped = markdownTransform("bold", "hello", { from: 0, to: 5 });
    expect(wrapped.insert).toBe("**hello**");

    const unwrapped = markdownTransform("bold", wrapped.insert, {
      from: 0,
      to: wrapped.insert.length,
    });
    expect(unwrapped.insert).toBe("hello");
  });

  it("无选区时插入占位文本并选中它", () => {
    const edit = markdownTransform("italic", "", { from: 0, to: 0 });
    expect(edit.insert).toBe("*italic text*");
    expect(edit.selection).toEqual({ from: 1, to: 12 });
  });

  it("跨行列表按行处理并支持取消", () => {
    const edit = markdownTransform("unorderedList", "one\ntwo", {
      from: 0,
      to: 7,
    });
    expect(edit.insert).toBe("- one\n- two");
    expect(
      markdownTransform("unorderedList", edit.insert, {
        from: 0,
        to: edit.insert.length,
      }).insert,
    ).toBe("one\ntwo");
  });

  it("链接和表格保留可编辑的 Markdown 结构", () => {
    expect(markdownTransform("link", "name", { from: 0, to: 4 }).insert).toBe(
      "[name](https://)",
    );
    expect(markdownTransform("table", "", { from: 0, to: 0 }).insert).toContain(
      "| --- |",
    );
  });
});
