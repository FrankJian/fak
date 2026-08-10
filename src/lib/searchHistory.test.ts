import { describe, expect, it } from "vitest";
import { noteSearchHistory } from "./searchHistory";

describe("noteSearchHistory", () => {
  it("puts new entries first, deduplicates them, and caps the MRU list", () => {
    expect(noteSearchHistory(["two", "one"], "one", 2)).toEqual(["one", "two"]);
    expect(noteSearchHistory(["two", "one"], "three", 2)).toEqual([
      "three",
      "two",
    ]);
  });

  it("does not persist empty values", () => {
    expect(noteSearchHistory(["one"], "  ")).toEqual(["one"]);
  });
});
