import { open, type FileHandle } from "node:fs/promises";

/**
 * Identifies a stored upload from its own bytes. The file name and the type
 * the browser claims are never trusted (decision D8: PDF, DOCX, XLSX, ODT,
 * JPEG, PNG).
 *
 * Office and OpenDocument files are ZIP archives. Only the archive's table of
 * contents is read; nothing is decompressed, so a "zip bomb" cannot exhaust
 * memory or disk here. Refused:
 *
 * - anything not on the list (including legacy .doc/.xls, HTML, SVG and
 *   executables, whatever their name);
 * - documents with macros (`vbaProject.bin`, OpenDocument Basic or scripts);
 * - archives with encrypted entries (they cannot be scanned), ZIP64 archives
 *   (never needed below the size limit) and malformed archives.
 */

export type DocumentKind = "pdf" | "docx" | "xlsx" | "odt" | "jpeg" | "png";

export interface DetectedType {
  kind: DocumentKind;
  mimeType: string;
  /** Accepted extensions; the first is used when a name needs one. */
  extensions: readonly string[];
}

export type RejectionReason = "unsupported_type" | "macros" | "encrypted" | "malformed";

export type Detection = { ok: true; type: DetectedType } | { ok: false; reason: RejectionReason };

export const DOCUMENT_TYPES: Record<DocumentKind, DetectedType> = {
  pdf: { kind: "pdf", mimeType: "application/pdf", extensions: ["pdf"] },
  docx: {
    kind: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
  },
  xlsx: {
    kind: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
  },
  odt: { kind: "odt", mimeType: "application/vnd.oasis.opendocument.text", extensions: ["odt"] },
  jpeg: { kind: "jpeg", mimeType: "image/jpeg", extensions: ["jpg", "jpeg"] },
  png: { kind: "png", mimeType: "image/png", extensions: ["png"] },
};

const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_DIRECTORY = 0x06054b50;
/** End-of-directory record (22 bytes) plus the longest possible comment. */
const EOCD_SEARCH = 22 + 0xffff;
const MAX_ENTRIES = 20_000;

const accept = (kind: DocumentKind): Detection => ({ ok: true, type: DOCUMENT_TYPES[kind] });
const reject = (reason: RejectionReason): Detection => ({ ok: false, reason });

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

export async function detectFileType(path: string, size: number): Promise<Detection> {
  if (size < 8) return reject("unsupported_type");
  const file = await open(path, "r");
  try {
    const head = await readAt(file, 0, 8);
    if (head.subarray(0, 5).toString("latin1") === "%PDF-") return accept("pdf");
    if (head.equals(PNG_SIGNATURE)) return accept("png");
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return accept("jpeg");
    if (head.readUInt32LE(0) === ZIP_LOCAL_HEADER) return await detectZipDocument(file, size);
    return reject("unsupported_type");
  } finally {
    await file.close();
  }
}

interface ZipEntry {
  name: string;
  encrypted: boolean;
}

/** Reads the names in a ZIP archive's central directory, without decompressing anything. */
async function readZipEntries(file: FileHandle, size: number): Promise<ZipEntry[] | null> {
  const tailLength = Math.min(size, EOCD_SEARCH);
  const tail = await readAt(file, size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === ZIP_END_OF_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF mean "see the ZIP64 record": not needed for documents this small.
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return null;
  }
  const eocdPosition = size - tailLength + eocd;
  if (entryCount === 0 || entryCount > MAX_ENTRIES) return null;
  if (directoryOffset + directorySize > eocdPosition) return null;

  const directory = await readAt(file, directoryOffset, directorySize);
  if (directory.length !== directorySize) return null;

  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== ZIP_CENTRAL_HEADER) {
      return null;
    }
    const flags = directory.readUInt16LE(offset + 8);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > directory.length) return null;
    entries.push({
      name: directory.subarray(offset + 46, nameEnd).toString("utf8"),
      encrypted: (flags & 0x1) !== 0,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

/** OpenDocument files start with an uncompressed "mimetype" entry naming their type. */
async function readOdfMimetype(file: FileHandle): Promise<string | null> {
  const header = await readAt(file, 0, 30);
  if (header.length < 30) return null;
  const method = header.readUInt16LE(8);
  const compressedSize = header.readUInt32LE(18);
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const name = (await readAt(file, 30, nameLength)).toString("utf8");
  if (name !== "mimetype" || method !== 0 || compressedSize > 200) return null;
  return (await readAt(file, 30 + nameLength + extraLength, compressedSize)).toString("ascii");
}

async function detectZipDocument(file: FileHandle, size: number): Promise<Detection> {
  const entries = await readZipEntries(file, size);
  if (!entries) return reject("malformed");
  if (entries.some((e) => e.encrypted)) return reject("encrypted");

  const names = new Set(entries.map((e) => e.name));
  const lower = entries.map((e) => e.name.toLowerCase());
  const hasMacros = lower.some(
    (name) =>
      name.endsWith("vbaproject.bin") ||
      name.endsWith("vbadata.xml") ||
      name.startsWith("basic/") ||
      name.startsWith("scripts/"),
  );

  if ((await readOdfMimetype(file)) === ODT_MIMETYPE && names.has("content.xml")) {
    return hasMacros ? reject("macros") : accept("odt");
  }
  if (names.has("[Content_Types].xml")) {
    if (hasMacros) return reject("macros");
    if (names.has("word/document.xml")) return accept("docx");
    if (names.has("xl/workbook.xml")) return accept("xlsx");
  }
  return reject("unsupported_type");
}
