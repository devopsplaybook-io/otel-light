import {
  SignalNormalizationId,
  SignalNormalizationSeverity,
  SignalNormalizationText,
  SignalNormalizationTimeUnixNano,
  SignalNormalizationTruncate,
  SIGNAL_MAX_TIME_UNIX_NANO,
} from "./SignalNormalization";

describe("SignalNormalizationSeverity", () => {
  it.each([
    [" error ", "ERROR"],
    ["Error", "ERROR"],
    ["ERROR\u0000", "ERROR"],
    ["warning", "WARN"],
    ["WARNING", "WARN"],
    ["information", "INFO"],
    ["notice", "INFO"],
    ["err", "ERROR"],
    ["critical", "FATAL"],
    ["crit", "FATAL"],
    ["alert", "FATAL"],
    ["emerg", "FATAL"],
    ["emergency", "FATAL"],
    ["warn2", "WARN"],
    ["WARNING2", "WARN"],
    ["error4", "ERROR"],
    ["trace1", "TRACE"],
    ["custom", "CUSTOM"],
    ["custom2", "CUSTOM2"],
  ])("canonicalizes %p to %p", (input, expected) => {
    expect(SignalNormalizationSeverity(input)).toBe(expected);
  });

  it("truncates unknown text to 50 characters", () => {
    expect(SignalNormalizationSeverity("x".repeat(60))).toHaveLength(50);
  });

  it.each([
    [1, "TRACE"],
    [4, "TRACE"],
    [5, "DEBUG"],
    [8, "DEBUG"],
    [9, "INFO"],
    [12, "INFO"],
    [13, "WARN"],
    [16, "WARN"],
    [17, "ERROR"],
    [20, "ERROR"],
    [21, "FATAL"],
    [24, "FATAL"],
    ["13", "WARN"],
  ])("derives severity from severityNumber %p", (number, expected) => {
    expect(SignalNormalizationSeverity(undefined, number)).toBe(expected);
  });

  it.each([0, -1, 25, 1.5, "abc", "", null, true])(
    "returns an empty severity for out-of-range severityNumber %p",
    (number) => {
      expect(SignalNormalizationSeverity(undefined, number)).toBe("");
    },
  );

  it("prefers severityText over severityNumber", () => {
    expect(SignalNormalizationSeverity("info", 17)).toBe("INFO");
  });

  it("falls back to severityNumber when severityText is blank", () => {
    expect(SignalNormalizationSeverity("   ", 21)).toBe("FATAL");
  });

  it("returns an empty severity when both are absent", () => {
    expect(SignalNormalizationSeverity(undefined)).toBe("");
  });
});

describe("SignalNormalizationTimeUnixNano", () => {
  it.each([undefined, null, "", "   "])("treats %p as missing", (value) => {
    expect(SignalNormalizationTimeUnixNano(value)).toEqual({ kind: "missing" });
  });

  it.each([
    [1, 1],
    [1_700_000_000_000_000_000, 1_700_000_000_000_000_000],
    ["1700000000000000000", 1_700_000_000_000_000_000],
    [SIGNAL_MAX_TIME_UNIX_NANO, SIGNAL_MAX_TIME_UNIX_NANO],
  ])("accepts valid time %p", (value, expected) => {
    expect(SignalNormalizationTimeUnixNano(value)).toEqual({
      kind: "valid",
      value: expected,
    });
  });

  it.each([
    "abc",
    0,
    -1,
    "1.5",
    NaN,
    Infinity,
    1e20,
    "1e30",
    1.5,
    true,
    {},
  ])("rejects invalid time %p", (value) => {
    expect(SignalNormalizationTimeUnixNano(value)).toEqual({ kind: "invalid" });
  });
});

describe("SignalNormalizationText and helpers", () => {
  it("strips NUL and stringifies finite numbers and booleans", () => {
    expect(SignalNormalizationText("a\u0000b")).toBe("ab");
    expect(SignalNormalizationText(42)).toBe("42");
    expect(SignalNormalizationText(true)).toBe("true");
  });

  it("returns an empty string for unsupported values", () => {
    expect(SignalNormalizationText(undefined)).toBe("");
    expect(SignalNormalizationText(null)).toBe("");
    expect(SignalNormalizationText(NaN)).toBe("");
    expect(SignalNormalizationText({})).toBe("");
    expect(SignalNormalizationText(["x"])).toBe("");
  });

  it("truncates to the requested width", () => {
    expect(SignalNormalizationTruncate("abcdef", 3)).toBe("abc");
    expect(SignalNormalizationTruncate(12_345, 3)).toBe("123");
  });

  it("accepts only non-empty string ids and truncates them to 50", () => {
    expect(SignalNormalizationId("trace-1")).toBe("trace-1");
    expect(SignalNormalizationId(" x\u0000y ")).toBe("xy");
    expect(SignalNormalizationId("a".repeat(60))).toHaveLength(50);
    expect(SignalNormalizationId("")).toBeNull();
    expect(SignalNormalizationId("   ")).toBeNull();
    expect(SignalNormalizationId(123)).toBeNull();
    expect(SignalNormalizationId(undefined)).toBeNull();
  });
});
