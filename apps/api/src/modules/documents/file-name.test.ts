import { describe, expect, it } from "vitest";
import { attachmentHeader, cleanFileName, FILE_NAME_MAX_LENGTH } from "./file-name.js";
import { DOCUMENT_TYPES } from "./file-type.js";

const pdf = DOCUMENT_TYPES.pdf;
const jpeg = DOCUMENT_TYPES.jpeg;
/** Right-to-left override, built from its code point so no raw control character sits in this file. */
const RLO = String.fromCodePoint(0x202e);

describe("cleanFileName", () => {
  it.each([
    ["Contrat de bail.pdf", "Contrat de bail.pdf"],
    ["../../etc/passwd.pdf", "passwd.pdf"],
    [String.raw`C:\Users\avocat\Bureau\note.pdf`, "note.pdf"],
    ["a<b>c:d|e?f*g.pdf", "a_b_c_d_e_f_g.pdf"],
    ["   espaces   multiples .pdf  ", "espaces multiples .pdf"],
    [".cache.pdf", "cache.pdf"],
    ["CON.pdf", "_CON.pdf"],
    ["", "document.pdf"],
    ["....", "document.pdf"],
    ["sans extension", "sans extension.pdf"],
    ["facture.PDF", "facture.pdf"],
    ["عقد الكراء.pdf", "عقد الكراء.pdf"],
  ])("%j becomes %j", (raw, expected) => {
    expect(cleanFileName(raw, pdf)).toBe(expected);
  });

  it("keeps the real extension visible: a PDF named .exe gets .pdf appended", () => {
    expect(cleanFileName("contrat.exe", pdf)).toBe("contrat.exe.pdf");
  });

  it("removes direction-reversing characters that would disguise the extension", () => {
    const disguised = `rapport${RLO}fdp.exe`;
    expect(cleanFileName(disguised, pdf)).toBe("rapportfdp.exe.pdf");
    expect(cleanFileName(disguised, pdf)).not.toContain(RLO);
  });

  it("accepts either JPEG extension", () => {
    expect(cleanFileName("photo.jpeg", jpeg)).toBe("photo.jpeg");
    expect(cleanFileName("photo.jpg", jpeg)).toBe("photo.jpg");
    expect(cleanFileName("photo.png", jpeg)).toBe("photo.png.jpg");
  });

  it("shortens long names without cutting the extension or a character in half", () => {
    const name = cleanFileName(`${"é".repeat(300)}.pdf`, pdf);
    expect(Array.from(name)).toHaveLength(FILE_NAME_MAX_LENGTH);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("attachmentHeader", () => {
  it("always downloads as an attachment, with an ASCII fallback and the exact UTF-8 name", () => {
    expect(attachmentHeader("Décision n°1 (appel).pdf")).toBe(
      "attachment; filename=\"Decision n1 (appel).pdf\"; filename*=UTF-8''D%C3%A9cision%20n%C2%B01%20%28appel%29.pdf",
    );
  });

  it("cannot be broken out of with quotes or new lines", () => {
    const header = attachmentHeader('a";\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith('attachment; filename="a_;')).toBe(true);
  });

  it("falls back to a generic name for names with no ASCII letters", () => {
    expect(attachmentHeader("عقد.pdf")).toBe(
      "attachment; filename=\"document\"; filename*=UTF-8''%D8%B9%D9%82%D8%AF.pdf",
    );
  });
});
