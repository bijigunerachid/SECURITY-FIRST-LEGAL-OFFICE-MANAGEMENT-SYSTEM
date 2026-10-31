import {
  MAX_INVOICE_LINES,
  MAX_QUANTITY_HUNDREDTHS,
  MAX_UNIT_PRICE_CENTIMES,
} from "@lexora/shared";
import { describe, expect, it } from "vitest";
import { computeInvoice, lineNet, toNumber, vatOn } from "./money.js";

describe("line amounts", () => {
  it("multiplies quantity (hundredths) by unit price and rounds half up to the centime", () => {
    expect(lineNet(100, 150_000)).toBe(150_000n); // 1 × 1 500,00
    expect(lineNet(150, 80_000)).toBe(120_000n); // 1,5 h × 800,00
    expect(lineNet(1, 50)).toBe(1n); // 0,01 × 0,50 = 0,005 → 0,01
    expect(lineNet(1, 49)).toBe(0n); // 0,0049 → 0,00
    expect(lineNet(333, 1)).toBe(3n); // 3,33 × 0,01 = 0,0333 → 0,03
  });

  it("rounds VAT half up", () => {
    expect(vatOn(150_000n, 2000)).toBe(30_000n);
    expect(vatOn(5n, 1000)).toBe(1n); // 0,005 → 0,01
    expect(vatOn(4n, 1000)).toBe(0n);
    expect(vatOn(123_457n, 2000)).toBe(24_691n); // 246,914 → 246,91
  });
});

describe("invoice totals", () => {
  it("applies the fee rate to fees only and computes VAT once per rate", () => {
    const invoice = computeInvoice(
      [
        {
          kind: "fee",
          description: "Honoraires",
          quantityHundredths: 100,
          unitPriceCentimes: 1_000_000,
        },
        {
          kind: "fee",
          description: "Vacation",
          quantityHundredths: 250,
          unitPriceCentimes: 60_000,
        },
        {
          kind: "disbursement",
          description: "Timbres",
          quantityHundredths: 100,
          unitPriceCentimes: 35_000,
        },
      ],
      2000,
    );
    expect(invoice.lines.map((l) => [l.vatRateBasisPoints, l.netCentimes])).toEqual([
      [2000, 1_000_000n],
      [2000, 150_000n],
      [0, 35_000n],
    ]);
    expect(invoice.vatBreakdown).toEqual([
      { rateBasisPoints: 2000, netCentimes: 1_150_000n, vatCentimes: 230_000n },
      { rateBasisPoints: 0, netCentimes: 35_000n, vatCentimes: 0n },
    ]);
    expect(invoice.subtotalCentimes).toBe(1_185_000n);
    expect(invoice.vatCentimes).toBe(230_000n);
    expect(invoice.totalCentimes).toBe(1_415_000n);
  });

  it("rounds the VAT of the sum, not of each line, so the breakdown adds up", () => {
    // Three lines of 0,05 at 10 %: per-line VAT would be 3 × 0,01 = 0,03; on the sum it is 0,02.
    const line = {
      kind: "fee" as const,
      description: "x",
      quantityHundredths: 100,
      unitPriceCentimes: 5,
    };
    const invoice = computeInvoice([line, line, line], 1000);
    expect(invoice.vatCentimes).toBe(2n);
    expect(invoice.totalCentimes).toBe(17n);
  });

  it("is empty for no lines", () => {
    expect(computeInvoice([], 2000)).toEqual({
      lines: [],
      vatBreakdown: [],
      subtotalCentimes: 0n,
      vatCentimes: 0n,
      totalCentimes: 0n,
    });
  });

  it("stays exact and within safe JSON numbers at the largest allowed invoice", () => {
    const line = {
      kind: "fee" as const,
      description: "x",
      quantityHundredths: MAX_QUANTITY_HUNDREDTHS,
      unitPriceCentimes: MAX_UNIT_PRICE_CENTIMES,
    };
    const invoice = computeInvoice(
      Array.from({ length: MAX_INVOICE_LINES }, () => line),
      3000,
    );
    expect(invoice.subtotalCentimes).toBe(500_000_000_000_000n);
    expect(invoice.totalCentimes).toBe(650_000_000_000_000n);
    expect(toNumber(invoice.totalCentimes)).toBe(650_000_000_000_000);
  });

  it("refuses to turn an unsafe amount into a JSON number", () => {
    expect(() => toNumber(2n ** 53n)).toThrow(RangeError);
  });
});
