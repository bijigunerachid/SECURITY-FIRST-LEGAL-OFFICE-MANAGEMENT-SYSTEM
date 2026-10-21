import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FAKE_MALWARE_MARKER,
  FAKE_SIGNATURE,
  startFakeClamd,
  type FakeClamd,
} from "../../test/fake-clamd.js";
import { ClamdScanner, ScannerUnavailableError, parseScanReply } from "./clamd.js";

let dir: string;
let fake: FakeClamd;
let scanner: ClamdScanner;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lexora-clamd-"));
  fake = await startFakeClamd();
  scanner = new ClamdScanner({ host: "127.0.0.1", port: fake.port, timeoutMs: 1_000 });
});
afterAll(async () => {
  await fake.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  fake.mode = "ok";
});

async function file(content: string | Buffer): Promise<string> {
  const path = join(dir, `f-${Math.random().toString(36).slice(2)}`);
  await writeFile(path, content);
  return path;
}

describe("parseScanReply", () => {
  it("understands clean and infected replies", () => {
    expect(parseScanReply("stream: OK")).toEqual({ clean: true });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND")).toEqual({
      clean: false,
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it("treats anything else as a scanner failure (fail closed)", () => {
    for (const reply of ["", "stream: ERROR", "INSTREAM size limit exceeded. ERROR", "OK"]) {
      expect(() => parseScanReply(reply), reply).toThrow(ScannerUnavailableError);
    }
  });

  it("keeps signature names short and plain", () => {
    const result = parseScanReply(`stream: ${"x".repeat(300)}<script> FOUND`);
    expect(result).toEqual({ clean: false, signature: "x".repeat(100) });
  });
});

describe("ClamdScanner against a clamd-compatible server", () => {
  it("streams the file and reports it clean", async () => {
    // Larger than one 64 KiB chunk, so several chunks are sent.
    expect(await scanner.scanFile(await file(Buffer.alloc(200_000, 1)))).toEqual({ clean: true });
  });

  it("reports what the scanner found", async () => {
    const path = await file(`prefix ${FAKE_MALWARE_MARKER} suffix`);
    expect(await scanner.scanFile(path)).toEqual({ clean: false, signature: FAKE_SIGNATURE });
  });

  it("returns the engine version", async () => {
    expect(await scanner.version()).toBe("ClamAV 0.0.0-fake/1/test");
  });

  it.each(["error", "close", "hang"] as const)(
    "fails closed when the scanner answers with %s",
    async (mode) => {
      fake.mode = mode;
      await expect(scanner.scanFile(await file("clean"))).rejects.toBeInstanceOf(
        ScannerUnavailableError,
      );
    },
  );

  it("fails closed when nothing listens", async () => {
    // Find a free port, then close it again so the connection is refused.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 1;
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    const down = new ClamdScanner({ host: "127.0.0.1", port, timeoutMs: 1_000 });
    await expect(down.scanFile(await file("clean"))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
    await expect(down.version()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});
