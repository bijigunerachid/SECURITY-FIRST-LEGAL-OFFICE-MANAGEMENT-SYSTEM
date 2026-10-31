import type { LineKind } from "@lexora/shared";

/**
 * Invoice arithmetic, in whole centimes with integer (BigInt) maths only.
 *
 * - A line's net amount is quantity (hundredths) × unit price, rounded to
 *   the centime, half up.
 * - VAT is computed once per rate on the sum of the lines at that rate,
 *   rounded half up, so the printed breakdown always adds up.
 * - Fee lines carry the invoice's fee rate; disbursements carry none.
 */

export interface LineInput {
  kind: LineKind;
  description: string;
  quantityHundredths: number;
  unitPriceCentimes: number;
}

export interface ComputedLine extends LineInput {
  vatRateBasisPoints: number;
  netCentimes: bigint;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  vatBreakdown: { rateBasisPoints: number; netCentimes: bigint; vatCentimes: bigint }[];
  subtotalCentimes: bigint;
  vatCentimes: bigint;
  totalCentimes: bigint;
}

/** a / b rounded half up, for non-negative a and positive b. */
function divideHalfUp(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new RangeError("divideHalfUp expects a >= 0 and b > 0");
  return (a * 2n + b) / (2n * b);
}

export function lineNet(quantityHundredths: number, unitPriceCentimes: number): bigint {
  return divideHalfUp(BigInt(quantityHundredths) * BigInt(unitPriceCentimes), 100n);
}

export function vatOn(netCentimes: bigint, rateBasisPoints: number): bigint {
  return divideHalfUp(netCentimes * BigInt(rateBasisPoints), 10_000n);
}

export function computeInvoice(
  lines: readonly LineInput[],
  feeVatRateBasisPoints: number,
): ComputedInvoice {
  const computed = lines.map((line) => ({
    ...line,
    vatRateBasisPoints: line.kind === "fee" ? feeVatRateBasisPoints : 0,
    netCentimes: lineNet(line.quantityHundredths, line.unitPriceCentimes),
  }));
  const byRate = new Map<number, bigint>();
  for (const line of computed) {
    byRate.set(
      line.vatRateBasisPoints,
      (byRate.get(line.vatRateBasisPoints) ?? 0n) + line.netCentimes,
    );
  }
  const vatBreakdown = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rateBasisPoints, netCentimes]) => ({
      rateBasisPoints,
      netCentimes,
      vatCentimes: vatOn(netCentimes, rateBasisPoints),
    }));
  const subtotalCentimes = vatBreakdown.reduce((sum, r) => sum + r.netCentimes, 0n);
  const vatCentimes = vatBreakdown.reduce((sum, r) => sum + r.vatCentimes, 0n);
  return {
    lines: computed,
    vatBreakdown,
    subtotalCentimes,
    vatCentimes,
    totalCentimes: subtotalCentimes + vatCentimes,
  };
}

/** A database amount as a JSON number. Amounts are bounded far below 2^53 by validation. */
export function toNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("amount out of range");
  return n;
}
