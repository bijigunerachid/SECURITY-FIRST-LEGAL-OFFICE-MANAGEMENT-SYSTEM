import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docm, docx, jpeg, odt, pdf, png, xlsx, zip } from "../../test/fixtures.js";
import { detectFileType } from "./file-type.js";

let dir: string;
let counter = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lexora-filetype-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function detect(content: Buffer) {
  counter += 1;
  const path = join(dir, `file-${counter}`);
  await writeFile(path, content);
  return detectFileType(path, content.length);
}

describe("detectFileType", () => {
  it.each([
    ["PDF", pdf(), "pdf", "application/pdf"],
    ["PNG", png(), "png", "image/png"],
    ["JPEG", jpeg(), "jpeg", "image/jpeg"],
    [
      "Word (DOCX)",
      docx(),
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "Excel (XLSX)",
      xlsx(),
      "xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["OpenDocument text (ODT)", odt(), "odt", "application/vnd.oasis.opendocument.text"],
  ])("accepts %s by its content", async (_label, content, kind, mimeType) => {
    expect(await detect(content)).toEqual({
      ok: true,
      type: expect.objectContaining({ kind, mimeType }),
    });
  });

  it.each([
    ["an executable", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)])],
    ["HTML", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ["plain text", Buffer.from("Ceci n'est pas un PDF %PDF-1.4")],
    [
      "a legacy Word file (OLE)",
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
    ],
    ["a plain ZIP archive", zip([{ name: "readme.txt", data: "hello" }])],
    ["a file too small to identify", Buffer.from("%PDF")],
    [
      "an OpenDocument spreadsheet",
      zip([
        { name: "mimetype", data: "application/vnd.oasis.opendocument.spreadsheet" },
        { name: "content.xml", data: "<x/>" },
      ]),
    ],
  ])("refuses %s", async (_label, content) => {
    expect(await detect(content)).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("refuses Office documents with macros, and OpenDocument files with scripts", async () => {
    expect(await detect(docm())).toEqual({ ok: false, reason: "macros" });
    expect(await detect(odt([{ name: "Basic/Standard/Module1.xml", data: "x" }]))).toEqual({
      ok: false,
      reason: "macros",
    });
    expect(await detect(odt([{ name: "Scripts/python/run.py", data: "x" }]))).toEqual({
      ok: false,
      reason: "macros",
    });
  });

  it("refuses archives with encrypted entries (they cannot be scanned)", async () => {
    expect(
      await detect(docx([{ name: "word/media/secret.bin", data: "x", encrypted: true }])),
    ).toEqual({
      ok: false,
      reason: "encrypted",
    });
  });

  it("refuses ZIP64 markers, truncated and corrupted archives", async () => {
    expect(await detect(zip([{ name: "a", data: "b" }], { zip64Marker: true }))).toEqual({
      ok: false,
      reason: "malformed",
    });
    const whole = docx();
    expect(await detect(whole.subarray(0, whole.length - 10))).toEqual({
      ok: false,
      reason: "malformed",
    });
    const corrupted = Buffer.from(whole);
    // Point the central directory past the end of the file.
    corrupted.writeUInt32LE(0xfffffff0, corrupted.length - 6);
    expect(await detect(corrupted)).toEqual({ ok: false, reason: "malformed" });
  });
});
