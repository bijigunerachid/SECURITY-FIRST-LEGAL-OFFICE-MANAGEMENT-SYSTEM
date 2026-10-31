/**
 * CSV for spreadsheets (Excel, LibreOffice) in a French locale: semicolon
 * separators, CRLF line ends and a UTF-8 byte-order mark so Arabic names
 * open correctly.
 *
 * Formula injection (CWE-1236): a text cell that starts with = + - @, a tab
 * or a carriage return can be run as a formula by the spreadsheet. Such
 * cells are prefixed with an apostrophe, which spreadsheets show as text.
 * Amounts are formatted by us and passed as numbers, so they are never
 * prefixed.
 */

export type CsvCell = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;

export function textCell(value: string | null): string {
  if (value === null) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Centimes as a French decimal: 1234567 → "12345,67", -500 → "-5,00". */
export function amountCell(centimes: number): string {
  const sign = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  return `${sign}${String(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

/** Built from its code so no invisible character sits in the source. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function toCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  const line = (cells: readonly CsvCell[]) =>
    cells.map((cell) => (typeof cell === "number" ? amountCell(cell) : textCell(cell))).join(";");
  return `${BYTE_ORDER_MARK}${[line(header), ...rows.map(line)].join("\r\n")}\r\n`;
}
