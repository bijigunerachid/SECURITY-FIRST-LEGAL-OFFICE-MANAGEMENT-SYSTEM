import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdf } from "../../test/fixtures.js";
import { ClamdScanner } from "./clamd.js";

/**
 * Against a real ClamAV daemon. Runs when CLAMAV_TEST_PORT is set (CI starts
 * ClamAV for this); skipped otherwise, because ClamAV needs 1–2 GB of memory.
 *
 * The EICAR file is the industry-standard, harmless test file every
 * antivirus detects. It is kept reversed and base64-encoded here so that no
 * scanner flags this source file itself; it only exists, briefly, in a
 * temporary folder while the test runs.
 */

const EICAR_REVERSED_BASE64 =
  "KkgrSCQhRUxJRi1UU0VULVNVUklWSVROQS1EUkFETkFUUy1SQUNJRSR9NylDQzcpXlAoNDVYWlBcNFtQQUAlUCFPNVg=";
/** EICAR is plain ASCII, so reversing its bytes reverses its characters. */
const eicar = () => Buffer.from(EICAR_REVERSED_BASE64, "base64").reverse().toString("latin1");

const port = process.env["CLAMAV_TEST_PORT"];
let dir: string;

describe.skipIf(port === undefined)("ClamdScanner against a real ClamAV daemon", () => {
  const scanner = new ClamdScanner({
    host: process.env["CLAMAV_TEST_HOST"] ?? "127.0.0.1",
    port: Number(port),
    timeoutMs: 60_000,
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lexora-clamav-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports its version", async () => {
    expect(await scanner.version()).toMatch(/^ClamAV \d+\.\d+/);
  });

  it("finds the EICAR test file", async () => {
    const path = join(dir, "eicar");
    await writeFile(path, eicar(), "latin1");
    const result = await scanner.scanFile(path);
    expect(result.clean).toBe(false);
    expect(result.clean ? "" : result.signature).toMatch(/eicar/i);
  });

  it("passes a clean PDF", async () => {
    const path = join(dir, "clean.pdf");
    await writeFile(path, pdf());
    expect(await scanner.scanFile(path)).toEqual({ clean: true });
  });
});
