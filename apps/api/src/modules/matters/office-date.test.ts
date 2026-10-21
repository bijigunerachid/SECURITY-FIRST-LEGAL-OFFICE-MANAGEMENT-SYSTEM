import { describe, expect, it } from "vitest";
import { runtimeTzdata, tzdataIsCurrent } from "../../lib/tzdata.js";
import { daysBetween, fromOfficeLocal, officeToday, toOfficeLocal } from "./office-date.js";

describe("office time (Africa/Casablanca)", () => {
  // Settled past dates (every time-zone database agrees on them): UTC+1 in
  // November 2025, UTC+0 during Ramadan 2025.
  it("converts office wall-clock times to instants, including the Ramadan offset", () => {
    expect(fromOfficeLocal("2025-11-03T09:30").toISOString()).toBe("2025-11-03T08:30:00.000Z");
    expect(fromOfficeLocal("2025-03-10T09:30").toISOString()).toBe("2025-03-10T09:30:00.000Z");
  });

  it("shows instants in office time", () => {
    expect(toOfficeLocal(new Date("2025-11-03T08:30:00Z"))).toBe("2025-11-03T09:30");
    expect(toOfficeLocal(new Date("2025-03-10T09:30:00Z"))).toBe("2025-03-10T09:30");
  });

  it.skipIf(!tzdataIsCurrent(runtimeTzdata()))(
    "follows Morocco's move to permanent UTC+0 on 2026-09-20 (needs tzdata 2026c or later)",
    () => {
      expect(fromOfficeLocal("2026-09-19T09:30").toISOString()).toBe("2026-09-19T08:30:00.000Z");
      expect(fromOfficeLocal("2026-11-03T09:30").toISOString()).toBe("2026-11-03T09:30:00.000Z");
    },
  );

  it("round-trips across the year", () => {
    for (let month = 1; month <= 12; month += 1) {
      const local = `2025-${String(month).padStart(2, "0")}-15T14:05`;
      expect(toOfficeLocal(fromOfficeLocal(local))).toBe(local);
    }
  });

  it("refuses malformed input", () => {
    expect(() => fromOfficeLocal("2026-11-03 09:30")).toThrow();
  });

  it("counts calendar days", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-21", "2026-10-20")).toBe(-1);
    expect(officeToday(new Date("2025-03-10T23:30:00Z"))).toBe("2025-03-10");
    expect(officeToday(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
  });
});
