/**
 * File names as shown to people. A name typed or chosen on the user's
 * computer is untrusted: it is never used to build a path on the server
 * (files are stored under random UUIDs), only kept as a label and offered
 * back as the download name. It is cleaned so it cannot:
 *
 * - reach outside a folder or carry a path (`../`, `C:\`, `/etc/`),
 * - hide its real extension behind direction-reversing characters
 *   ("Trojan Source" style: `report[RLO]fdp.exe`),
 * - contain control characters or characters Windows refuses in names,
 * - be a Windows device name (`CON`, `NUL`, `COM1`...),
 * - grow without bound.
 */

/** Control (Cc) and invisible format characters (Cf: bidi controls, zero-width, BOM). */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
/** Characters Windows does not allow in file names. */
const RESERVED = /[<>:"/\\|?*]/g;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
export const FILE_NAME_MAX_LENGTH = 200;

/** Splits "name.ext" into stem and lowercase extension (without the dot). */
export function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() };
}

/**
 * Cleans a file name and makes its extension match the type detected from
 * the file's bytes: a PDF uploaded as "contract.exe" is offered back as
 * "contract.exe.pdf", never as an ".exe".
 */
export function cleanFileName(raw: string, detected: { extensions: readonly string[] }): string {
  const lastSegment = raw.split(/[/\\]/).pop() ?? "";
  let name = lastSegment
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(RESERVED, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Leading dots would make hidden files; trailing dots and spaces are dropped by Windows.
    .replace(/^[.\s]+|[.\s]+$/g, "");

  const parts = splitExtension(name);
  const { extension } = parts;
  let { stem } = parts;
  if (WINDOWS_DEVICE.test(stem)) stem = `_${stem}`;
  if (stem === "") stem = "document";

  const wanted = detected.extensions[0] ?? "bin";
  const keeps = detected.extensions.includes(extension);
  const suffix = keeps ? `.${extension}` : extension ? `.${extension}.${wanted}` : `.${wanted}`;
  // Shorten the stem, not the extension, and never cut a character in half.
  const room = FILE_NAME_MAX_LENGTH - suffix.length;
  const characters = Array.from(stem);
  if (characters.length > room) stem = characters.slice(0, room).join("").trimEnd();
  name = `${stem}${suffix}`;
  return name;
}

/**
 * The `Content-Disposition` header for a download: always `attachment` (never
 * displayed inline by the browser), with an ASCII fallback and the exact
 * name in RFC 5987 encoding.
 */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\%]/g, "_")
    .trim();
  const fallback = ascii === "" || ascii.startsWith(".") ? "document" : ascii;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
