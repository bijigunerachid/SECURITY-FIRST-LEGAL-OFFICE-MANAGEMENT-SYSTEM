import { describe, expect, it } from "vitest";
import { daysBetween, fromOfficeLocal, officeToday, toOfficeLocal } from "./office-date.js";

describe("office time (Africa/Casablanca)", () => {
  it("converts office wall-clock times to instants, including the Ramadan offset", () => {
    // Normally UTC+1.
    expect(fromOfficeLocal("2026-11-03T09:30").toISOString()).toBe("2026-11-03T08:30:00.000Z");
    // During Ramadan 2026 Morocco is on UTC+0.
    expect(fromOfficeLocal("2026-03-01T09:30").toISOString()).toBe("2026-03-01T09:30:00.000Z");
  });

  it("shows instants in office time", () => {
    expect(toOfficeLocal(new Date("2026-11-03T08:30:00Z"))).toBe("2026-11-03T09:30");
    expect(toOfficeLocal(new Date("2026-03-01T09:30:00Z"))).toBe("2026-03-01T09:30");
  });

  it("round-trips across the year", () => {
    for (let month = 1; month <= 12; month += 1) {
      const local = `2026-${String(month).padStart(2, "0")}-15T14:05`;
      expect(toOfficeLocal(fromOfficeLocal(local))).toBe(local);
    }
  });

  it("refuses malformed input", () => {
    expect(() => fromOfficeLocal("2026-11-03 09:30")).toThrow();
  });

  it("counts calendar days", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-21", "2026-10-20")).toBe(-1);
    expect(officeToday(new Date("2026-03-01T23:30:00Z"))).toBe("2026-03-01");
  });
});
