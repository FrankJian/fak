// @ts-expect-error Vitest 在 Node 中运行此守卫；前端产物刻意不引入 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/design/base.css", "utf8");

describe("Markdown preview typography", () => {
  it("gives the first three heading levels distinct size and weight", () => {
    for (const level of [1, 2, 3]) {
      const rule = new RegExp(
        `\\.markdown-preview-content h${level}\\s*\\{[^}]*font-size:[^}]*font-weight:`,
        "s",
      );
      expect(css).toMatch(rule);
    }
  });

  it("restores unordered and ordered list markers after the CSS reset", () => {
    expect(css).toMatch(
      /\.markdown-preview-content ul\s*\{[^}]*list-style:\s*disc/s,
    );
    expect(css).toMatch(
      /\.markdown-preview-content ol\s*\{[^}]*list-style:\s*decimal/s,
    );
  });
});
