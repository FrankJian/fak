import { describe, expect, it } from "vitest";
import { documentDelta } from "./documentDelta";

describe("documentDelta", () => {
  it("replaces only the changed span in a later line", () => {
    expect(documentDelta("first\nsecond\nthird", "first\nsecond!\nthird"))
      .toEqual({ from: 12, to: 12, insert: "!" });
  });

  it("keeps surrogate pairs intact when neighboring emoji differ", () => {
    expect(documentDelta("x😀z", "x😃z"))
      .toEqual({ from: 1, to: 3, insert: "😃" });
  });

  it("returns no edit for matching text", () => {
    expect(documentDelta("same", "same")).toBeNull();
  });
});
