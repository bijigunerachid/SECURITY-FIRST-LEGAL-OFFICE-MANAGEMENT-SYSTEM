import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves conflicting Tailwind classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Unicode "left-to-right isolate" and "pop directional isolate", built from their code points. */
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Keeps a left-to-right value (a matter reference such as 2026-0001, a case
 * number) in reading order when it is placed inside a sentence that may be
 * right-to-left (Arabic). Without it, "2026-0001" can show as "0001-2026".
 */
export function ltr(value: string): string {
  return `${LRI}${value}${PDI}`;
}
