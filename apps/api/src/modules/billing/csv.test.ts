import { describe, expect, it } from "vitest";
import { amountCell, textCell, toCsv } from "./csv.js";

describe("CSV text cells", () => {
  it("neutralises cells a spreadsheet would run as formulas", () => {
    expect(textCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(textCell("+212600000000")).toBe("'+212600000000");
    expect(textCell("-2+3")).toBe("'-2+3");
    expect(textCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(textCell("\t=1")).toBe("'\t=1");
    expect(textCell("\r=1")).toBe('"\'\r=1"');
  });

  it("leaves ordinary text alone and quotes separators, quotes and line breaks", () => {
    expect(textCell("Salma Berrada")).toBe("Salma Berrada");
    expect(textCell("سلمى برادة")).toBe("سلمى برادة");
    expect(textCell("Atlas; SARL")).toBe('"Atlas; SARL"');
    expect(textCell('dit "le juste"')).toBe('"dit ""le juste"""');
    expect(textCell("ligne 1\nligne 2")).toBe('"ligne 1\nligne 2"');
    expect(textCell(" espace")).toBe('" espace"');
    expect(textCell(null)).toBe("");
  });
});

describe("CSV amounts", () => {
  it("writes centimes as French decimals, never prefixed", () => {
    expect(amountCell(1_234_567)).toBe("12345,67");
    expect(amountCell(5)).toBe("0,05");
    expect(amountCell(0)).toBe("0,00");
    expect(amountCell(-50_000)).toBe("-500,00");
  });
});

describe("CSV document", () => {
  it("starts with a byte-order mark and uses semicolons and CRLF", () => {
    const csv = toCsv(
      ["Numéro", "TTC"],
      [
        ["F-2026-0001", 120_000],
        ["=1+1", -100],
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("Numéro;TTC\r\nF-2026-0001;1200,00\r\n'=1+1;-1,00\r\n");
  });
});
