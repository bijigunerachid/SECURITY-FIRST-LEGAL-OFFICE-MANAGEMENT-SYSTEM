import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Private document storage (ADR 0004). Two folders under one root:
 *
 * - `quarantine/`: uploads being received, checked and scanned;
 * - `store/`: files that passed every check.
 *
 * Both live on the same file system, so promoting a file is an atomic
 * rename. Names are random UUIDs generated here; nothing from the request is
 * ever used in a path. Folders are owner-only (0700) and files 0600.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class UploadTooLargeError extends Error {
  constructor() {
    super("upload exceeds the size limit");
    this.name = "UploadTooLargeError";
  }
}

export interface ReceivedFile {
  /** Path inside quarantine. */
  path: string;
  size: number;
  sha256: Buffer;
}

/** Counts bytes and hashes them while they pass through; fails as soon as the limit is crossed. */
class LimitAndHash extends Transform {
  readonly hash = createHash("sha256");
  size = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (e?: Error) => void) {
    this.size += chunk.length;
    if (this.size > this.limit) {
      callback(new UploadTooLargeError());
      return;
    }
    this.hash.update(chunk);
    callback();
    this.push(chunk);
  }
}

export class DocumentStorage {
  private readonly quarantineDir: string;
  private readonly storeDir: string;

  constructor(root: string) {
    this.quarantineDir = join(root, "quarantine");
    this.storeDir = join(root, "store");
  }

  /** Creates the folders with owner-only rights and checks they are writable. */
  async init(): Promise<void> {
    for (const dir of [this.quarantineDir, this.storeDir]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
    }
    const probe = join(this.quarantineDir, `.probe-${randomUUID()}`);
    await writeFile(probe, "", { mode: 0o600, flag: "wx" });
    await rm(probe);
  }

  private storePath(key: string): string {
    // Keys come from the database, which only ever holds UUIDs generated here.
    if (!UUID.test(key)) throw new Error("invalid storage key");
    return join(this.storeDir, key);
  }

  /**
   * Streams a request body into quarantine, enforcing the size limit while it
   * arrives. Any failure (too large, client gone, disk error) removes the
   * partial file.
   */
  async receive(body: Readable, maxBytes: number): Promise<ReceivedFile> {
    const path = join(this.quarantineDir, randomUUID());
    const counter = new LimitAndHash(maxBytes);
    try {
      await pipeline(body, counter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    } catch (error) {
      await this.discard(path);
      throw error;
    }
    return { path, size: counter.size, sha256: counter.hash.digest() };
  }

  /** Moves a checked file from quarantine into storage under a new random key. */
  async promote(quarantined: string): Promise<string> {
    const key = randomUUID();
    await rename(quarantined, this.storePath(key));
    return key;
  }

  /** Deletes a quarantined file (rejected, failed or abandoned upload). */
  async discard(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  /** Removes a stored file. Only used to undo a promotion whose database write failed. */
  async removeStored(key: string): Promise<void> {
    await rm(this.storePath(key), { force: true });
  }

  async size(key: string): Promise<number> {
    return (await stat(this.storePath(key))).size;
  }

  read(key: string): ReadStream {
    return createReadStream(this.storePath(key));
  }
}
