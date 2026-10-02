import { describe, expect, it } from "vitest";
import {
  SignalCursorCompare,
  SignalCursorMax,
  SignalDedupeById,
  SignalQueryAdd,
} from "../services/SignalCursors";

describe("SignalCursorCompare", () => {
  it("orders by time first", () => {
    expect(
      SignalCursorCompare({ time: 10, id: "b" }, { time: 20, id: "a" }),
    ).toBeLessThan(0);
    expect(
      SignalCursorCompare({ time: 20, id: "a" }, { time: 10, id: "b" }),
    ).toBeGreaterThan(0);
  });

  it("orders by id when times are equal", () => {
    expect(
      SignalCursorCompare({ time: 10, id: "a" }, { time: 10, id: "b" }),
    ).toBeLessThan(0);
    expect(
      SignalCursorCompare({ time: 10, id: "b" }, { time: 10, id: "a" }),
    ).toBeGreaterThan(0);
  });

  it("returns 0 for identical cursors", () => {
    expect(SignalCursorCompare({ time: 10, id: "a" }, { time: 10, id: "a" })).toBe(
      0,
    );
  });
});

describe("SignalCursorMax", () => {
  it("returns the newer cursor", () => {
    expect(
      SignalCursorMax({ time: 10, id: "b" }, { time: 20, id: "a" }),
    ).toEqual({ time: 20, id: "a" });
    expect(
      SignalCursorMax({ time: 20, id: "b" }, { time: 20, id: "a" }),
    ).toEqual({ time: 20, id: "b" });
  });
});

describe("SignalDedupeById", () => {
  it("removes duplicates within the same batch, keeping the first occurrence", () => {
    const items = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "a", value: 3 },
    ];
    expect(SignalDedupeById(items, (item) => item.id)).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]);
  });

  it("filters out ids already seen and records kept ids in the set", () => {
    const seen = new Set(["old"]);
    const items = [{ id: "old" }, { id: "new" }];
    expect(SignalDedupeById(items, (item) => item.id, seen)).toEqual([
      { id: "new" },
    ]);
    expect(seen.has("new")).toBe(true);
  });

  it("drops items without an id (they cannot be deduplicated)", () => {
    const items = [{ id: undefined }, { id: "a" }, { id: null }];
    expect(
      SignalDedupeById(items as { id: string }[], (item) => item.id),
    ).toEqual([{ id: "a" }]);
  });
});

describe("SignalQueryAdd", () => {
  it("starts a query string when empty", () => {
    expect(SignalQueryAdd("", "before", 123)).toBe("before=123");
  });

  it("appends to an existing query string", () => {
    expect(SignalQueryAdd("keywords=abc", "beforeRecordId", "r-1")).toBe(
      "keywords=abc&beforeRecordId=r-1",
    );
  });

  it("URL-encodes values", () => {
    expect(SignalQueryAdd("", "beforeRecordId", "a b&c")).toBe(
      "beforeRecordId=a%20b%26c",
    );
  });
});

describe("cursor chaining across refresh batches", () => {
  it("computes the newest cursor from successive batches", () => {
    const batches = [
      [
        { time: 30, id: "c" },
        { time: 20, id: "b" },
      ],
      [
        { time: 15, id: "z" },
        { time: 10, id: "a" },
      ],
    ];
    let newest = { time: 5, id: "start" };
    for (const batch of batches) {
      newest = SignalCursorMax(newest, batch[0]);
    }
    expect(newest).toEqual({ time: 30, id: "c" });
  });

  it("advances the upper bound to the oldest item of each batch", () => {
    const batch = [
      { time: 30, id: "c" },
      { time: 20, id: "b" },
    ];
    const upperBound = batch[batch.length - 1];
    expect(SignalCursorCompare(upperBound, batch[0])).toBeLessThan(0);
  });
});
