import { describe, expect, it } from "vitest";
import { REQUIRED_TZDATA, tzdataCheck, tzdataIsCurrent } from "./tzdata.js";

describe("time-zone data check", () => {
  it("accepts 2026c and later, refuses older or unknown versions", () => {
    for (const version of ["2026c", "2026d", "2027a"]) expect(tzdataIsCurrent(version)).toBe(true);
    for (const version of ["2024b", "2026a", "2026b", "", "latest", undefined]) {
      expect(tzdataIsCurrent(version)).toBe(false);
    }
    expect(REQUIRED_TZDATA).toBe("2026c");
  });

  it("refuses to start in production on outdated data, and only warns elsewhere", () => {
    expect(tzdataCheck(true, "2024b")).toBe("refuse");
    expect(tzdataCheck(false, "2024b")).toBe("warn");
    expect(tzdataCheck(true, "2026c")).toBe("ok");
    // An unknown version is never treated as current.
    expect(tzdataCheck(true, undefined)).toBe("refuse");
  });
});
