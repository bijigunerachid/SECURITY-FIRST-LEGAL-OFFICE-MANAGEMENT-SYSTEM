import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentStorage, UploadTooLargeError } from "./storage.js";

let root: string;
let storage: DocumentStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lexora-storage-"));
  storage = new DocumentStorage(root);
  await storage.init();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const files = async (folder: "quarantine" | "store") => readdir(join(root, folder));

describe("DocumentStorage", () => {
  it("receives into quarantine with size and hash, then promotes under a new random name", async () => {
    const content = Buffer.from("contenu du document");
    const received = await storage.receive(Readable.from([content]), 1024);
    expect(received.size).toBe(content.length);
    expect(received.sha256.equals(createHash("sha256").update(content).digest())).toBe(true);
    expect(await files("quarantine")).toHaveLength(1);

    const key = await storage.promote(received.path);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await files("quarantine")).toEqual([]);
    expect(await files("store")).toEqual([key]);
    expect(await readFile(join(root, "store", key))).toEqual(content);
  });

  it("stops at the size limit and leaves nothing behind", async () => {
    const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(storage.receive(big, 1000)).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(await files("quarantine")).toEqual([]);
  });

  it("removes the partial file when the client goes away mid-upload", async () => {
    const body = new PassThrough();
    const receiving = storage.receive(body, 10_000);
    body.write(Buffer.alloc(100));
    body.destroy(new Error("client disconnected"));
    await expect(receiving).rejects.toThrow("client disconnected");
    expect(await files("quarantine")).toEqual([]);
  });

  it("only ever builds paths from UUID keys", () => {
    expect(() => storage.read("../../etc/passwd")).toThrow("invalid storage key");
    expect(() => storage.read("../quarantine/x")).toThrow("invalid storage key");
  });

  it.skipIf(process.platform === "win32")("creates owner-only folders", async () => {
    expect((await stat(join(root, "store"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "quarantine"))).mode & 0o777).toBe(0o700);
  });
});
