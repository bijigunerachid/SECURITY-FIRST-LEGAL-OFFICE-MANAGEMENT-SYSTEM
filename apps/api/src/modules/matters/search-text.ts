/**
 * Search keys for names and identifiers.
 *
 * Names are typed in French and Arabic, with or without accents and
 * diacritics, and in several spellings of the same Arabic letters. A
 * conflict search that misses "Benâli" when looking for "BENALI", or "أحمد"
 * when looking for "احمد", fails at its one job. Both the stored key and the
 * search text go through the same function.
 */

/** Arabic harakat, tanwin, shadda, sukun, superscript alef, Quranic marks. */
const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const TATWEEL = /\u0640/g;
const ARABIC_LETTER_VARIANTS: Record<string, string> = {
  أ: "ا", // أ → ا
  إ: "ا", // إ → ا
  آ: "ا", // آ → ا
  ٱ: "ا", // ٱ → ا
  ى: "ي", // ى → ي
  ة: "ه", // ة → ه
  ؤ: "و", // ؤ → و
  ئ: "ي", // ئ → ي
};
const ARABIC_VARIANT_PATTERN = new RegExp(`[${Object.keys(ARABIC_LETTER_VARIANTS).join("")}]`, "g");
/** Latin combining accents (after NFD). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function searchKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(ARABIC_VARIANT_PATTERN, (letter) => ARABIC_LETTER_VARIANTS[letter] ?? letter)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Identifiers (CIN, ICE, RC…): uppercase, without spaces or separators. */
export function identifierKey(identifier: string): string {
  return identifier
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
