import { createReadStream } from "node:fs";
import { connect, type Socket } from "node:net";

/**
 * Client for the ClamAV daemon (clamd) over TCP, using its INSTREAM command:
 * the file is sent in length-prefixed chunks and clamd answers
 * "stream: OK" or "stream: <signature> FOUND".
 *
 * Fail closed: anything other than a clear "OK" (connection refused,
 * timeout, an error reply, an answer we do not understand) is an error, and
 * the upload is refused. A file is never stored because scanning failed.
 */

export interface ScannerSettings {
  host: string;
  port: number;
  timeoutMs: number;
}

export type ScanResult = { clean: true } | { clean: false; signature: string };

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerUnavailableError";
  }
}

export interface MalwareScanner {
  scanFile(path: string): Promise<ScanResult>;
  /** Engine and signature database version, recorded with each scanned file. */
  version(): Promise<string>;
}

/** clamd answers end with a NUL byte when commands are prefixed with "z". */
const TERMINATOR = 0;
const CHUNK_SIZE = 64 * 1024;
const MAX_REPLY = 4096;

/** Signature names are recorded in the audit log: keep them short and plain. */
function cleanSignature(name: string): string {
  return name.replace(/[^\w.:/+-]/g, "_").slice(0, 100);
}

export function parseScanReply(reply: string): ScanResult {
  const text = reply.trim();
  if (text === "stream: OK") return { clean: true };
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found?.[1]) return { clean: false, signature: cleanSignature(found[1]) };
  throw new ScannerUnavailableError("unexpected scanner reply");
}

export class ClamdScanner implements MalwareScanner {
  constructor(private readonly settings: ScannerSettings) {}

  /** Opens a connection, runs `exchange`, and returns clamd's NUL-terminated reply. */
  private request(exchange: (socket: Socket) => Promise<void>): Promise<string> {
    const { host, port, timeoutMs } = this.settings;
    return new Promise<string>((resolve, reject) => {
      const socket = connect({ host, port });
      const chunks: Buffer[] = [];
      let length = 0;
      let settled = false;
      const finish = (error: Error | null, reply?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(reply ?? "");
      };
      const timer = setTimeout(() => {
        finish(new ScannerUnavailableError("scanner timed out"));
      }, timeoutMs);

      socket.on("error", () => {
        finish(new ScannerUnavailableError("scanner connection failed"));
      });
      socket.on("data", (data: Buffer) => {
        chunks.push(data);
        length += data.length;
        const all = Buffer.concat(chunks, length);
        const end = all.indexOf(TERMINATOR);
        if (end >= 0) finish(null, all.subarray(0, end).toString("utf8"));
        else if (length > MAX_REPLY) finish(new ScannerUnavailableError("scanner reply too long"));
      });
      socket.on("close", () => {
        finish(new ScannerUnavailableError("scanner closed the connection without a reply"));
      });
      socket.on("connect", () => {
        exchange(socket).catch((error: unknown) => {
          finish(
            error instanceof Error ? error : new ScannerUnavailableError("scanner write failed"),
          );
        });
      });
    });
  }

  async scanFile(path: string): Promise<ScanResult> {
    const reply = await this.request(async (socket) => {
      await write(socket, Buffer.from("zINSTREAM\0", "latin1"));
      for await (const chunk of createReadStream(path, { highWaterMark: CHUNK_SIZE })) {
        const data = chunk as Buffer;
        const size = Buffer.alloc(4);
        size.writeUInt32BE(data.length, 0);
        await write(socket, size);
        await write(socket, data);
      }
      // A zero-length chunk ends the stream.
      await write(socket, Buffer.alloc(4));
    });
    return parseScanReply(reply);
  }

  async version(): Promise<string> {
    const reply = await this.request((socket) =>
      write(socket, Buffer.from("zVERSION\0", "latin1")),
    );
    return reply.trim().slice(0, 64);
  }
}

function write(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => {
      if (error) reject(new ScannerUnavailableError("scanner write failed"));
      else resolve();
    });
  });
}
