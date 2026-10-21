import { describe, expect, it } from "vitest";
import { fromDbDate, officeToday, toDbDate } from "./office-date.js";
import { identifierKey, searchKey } from "./search-text.js";

describe("searchKey", () => {
  it.each([
    ["Hélène BENÂLI", "helene benali"],
    ["  Société   Générale-Maroc ", "societe generale maroc"],
    ["O'Connor & Fils", "o connor fils"],
    // Hamza forms of alef, alef maqsura, ta marbuta and diacritics.
    ["أحمد", "احمد"],
    ["إدريس", "ادريس"],
    ["آمنة", "امنه"],
    ["مُصْطَفَى", "مصطفي"],
    ["فاطمة الزهراء", "فاطمه الزهراء"],
    // Tatweel (decorative stretching) is ignored.
    ["محـــمد", "محمد"],
    ["شركة Atlas", "شركه atlas"],
    ["%_\\", ""],
  ])("%s → %s", (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });

  it("gives the same key to every common spelling of the same name", () => {
    expect(searchKey("أحمد الإدريسي")).toBe(searchKey("احمد الادريسي"));
    expect(searchKey("Benâli")).toBe(searchKey("BENALI"));
  });
});

describe("identifierKey", () => {
  it("removes separators and spaces and uppercases", () => {
    expect(identifierKey("bk-123.456")).toBe("BK123456");
    expect(identifierKey("ICE 0012 3456 7000 089")).toBe("ICE001234567000089");
  });
});

describe("office dates", () => {
  it("uses the Moroccan calendar day, not UTC", () => {
    // 23:30 UTC on 31 December is already 1 January in Casablanca (UTC+1).
    expect(officeToday(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(officeToday(new Date("2026-06-15T12:00:00Z"))).toMatch(/^2026-06-15$/);
  });

  it("round-trips dates stored in DATE columns", () => {
    expect(fromDbDate(toDbDate("2026-02-28"))).toBe("2026-02-28");
  });
});
