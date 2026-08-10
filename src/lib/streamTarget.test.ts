import { describe, expect, it } from "vitest";
import { parseStreamTarget } from "./streamTarget";

describe("parseStreamTarget", () => {
  it("treats a bare number as a 1-based line", () => {
    expect(parseStreamTarget("10", 100)).toBe(9);
  });

  it("maps a percentage onto the line range", () => {
    expect(parseStreamTarget("0%", 101)).toBe(0);
    expect(parseStreamTarget("50%", 101)).toBe(50);
    expect(parseStreamTarget("100%", 101)).toBe(100);
  });

  it("clamps out-of-range input instead of scrolling nowhere", () => {
    expect(parseStreamTarget("9999", 10)).toBe(9);
    expect(parseStreamTarget("250%", 10)).toBe(9);
    expect(parseStreamTarget("0", 10)).toBe(0);
  });

  it("refuses input it cannot read", () => {
    expect(parseStreamTarget("", 10)).toBeNull();
    expect(parseStreamTarget("abc", 10)).toBeNull();
    expect(parseStreamTarget("1e3", 10)).toBeNull();
    expect(parseStreamTarget("-5", 10)).toBeNull();
  });

  it("has nowhere to go in an empty document", () => {
    expect(parseStreamTarget("1", 0)).toBeNull();
  });
});
