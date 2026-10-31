import { afterEach, describe, expect, it } from "vitest";
import { officeToday, setOfficeUtcOffset } from "./office-date";

afterEach(() => {
  setOfficeUtcOffset(null);
});

describe("office date", () => {
  // 23:30 UTC: still the 30th in Morocco (UTC+0), already the 31st for a
  // device whose time-zone data wrongly keeps Morocco on UTC+1.
  const lateEvening = new Date("2026-10-30T23:30:00Z");

  it("follows the offset the server sent, not the device's time-zone data", () => {
    setOfficeUtcOffset(0);
    expect(officeToday(lateEvening)).toBe("2026-10-30");
    setOfficeUtcOffset(60);
    expect(officeToday(lateEvening)).toBe("2026-10-31");
    setOfficeUtcOffset(-60);
    expect(officeToday(new Date("2026-10-31T00:30:00Z"))).toBe("2026-10-30");
  });

  it("falls back to the device's data before the session has loaded", () => {
    expect(officeToday(new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-30");
  });
});
