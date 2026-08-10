import { describe, expect, it } from "vitest";
import {
  SearchSessionCache,
  searchSessionKey,
  type SearchSessionSnapshot,
} from "./searchSessionCache";
import type { SearchOptions } from "../ipc/search";

const options: SearchOptions = {
  mode: "literal",
  caseSensitive: false,
  wholeWord: false,
  multiline: false,
  parseEscapes: false,
};

function snapshot(sessionId: string): SearchSessionSnapshot {
  return {
    sessionId,
    total: 1,
    documentVersion: 1,
    rows: [],
    positions: [],
    current: -1,
  };
}

describe("searchSessionKey", () => {
  it("separates documents and every result-affecting option", () => {
    const base = searchSessionKey("a", "needle", options, undefined);
    expect(searchSessionKey("b", "needle", options, undefined)).not.toBe(base);
    expect(
      searchSessionKey(
        "a",
        "needle",
        { ...options, wholeWord: true },
        undefined,
      ),
    ).not.toBe(base);
    expect(
      searchSessionKey(
        "a",
        "needle",
        { ...options, parseEscapes: true },
        undefined,
      ),
    ).not.toBe(base);
    expect(
      searchSessionKey("a", "needle", options, { start: 1, end: 3 }),
    ).not.toBe(base);
    expect(
      searchSessionKey("a", "needle", options, undefined, "secondary"),
    ).not.toBe(base);
  });
});

describe("SearchSessionCache", () => {
  it("restores entries and evicts the least recently used session", () => {
    const cache = new SearchSessionCache(2);
    cache.set("first", snapshot("first-session"));
    cache.set("second", snapshot("second-session"));
    expect(cache.get("first")?.sessionId).toBe("first-session");

    expect(cache.set("third", snapshot("third-session"))).toBe(
      "second-session",
    );
    expect(cache.get("second")).toBeNull();
    expect(cache.get("first")?.sessionId).toBe("first-session");
  });

  it("returns all sessions when disposed", () => {
    const cache = new SearchSessionCache();
    cache.set("first", snapshot("first-session"));
    cache.set("second", snapshot("second-session"));

    expect(cache.drain()).toEqual(["first-session", "second-session"]);
    expect(cache.get("first")).toBeNull();
  });

  it("removes an entry when restoring it as the active session", () => {
    const cache = new SearchSessionCache();
    cache.set("current", snapshot("current-session"));

    expect(cache.take("current")?.sessionId).toBe("current-session");
    expect(cache.get("current")).toBeNull();
  });
});
