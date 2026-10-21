import { createServer, type Server, type Socket } from "node:net";

/**
 * A stand-in for the ClamAV daemon, for automated tests only. It speaks the
 * same INSTREAM protocol as clamd, so the real client code is exercised, and
 * reports a "virus" when the stream contains FAKE_MALWARE_MARKER.
 *
 * Why not the real EICAR test file: Windows Defender on a development
 * machine deletes or locks any file that contains it, which would make the
 * tests behave differently from CI. The real scanner and the real EICAR file
 * are tested against ClamAV in CI (clamd.real.int.test.ts).
 *
 * Never used by the application itself: the API always talks to the
 * scanner configured in CLAMAV_HOST/CLAMAV_PORT.
 */

export const FAKE_MALWARE_MARKER = "LEXORA-FAKE-MALWARE-TEST-MARKER";
export const FAKE_SIGNATURE = "Lexora.Test.Marker";

/** ok: scan normally; error: answer with a clamd error; hang: never answer; close: drop the connection. */
export type FakeMode = "ok" | "error" | "hang" | "close";

export interface FakeClamd {
  port: number;
  mode: FakeMode;
  /** Number of files scanned so far. */
  scans: number;
  close(): Promise<void>;
}

function handle(socket: Socket, state: FakeClamd): void {
  let buffer = Buffer.alloc(0);
  let command: string | null = null;
  let received = Buffer.alloc(0);

  socket.on("error", () => undefined);
  socket.on("data", (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    if (command === null) {
      const end = buffer.indexOf(0);
      if (end < 0) return;
      command = buffer.subarray(0, end).toString("latin1");
      buffer = buffer.subarray(end + 1);
      if (command === "zVERSION") {
        socket.end("ClamAV 0.0.0-fake/1/test\0");
        return;
      }
      if (command !== "zINSTREAM") {
        socket.end("UNKNOWN COMMAND\0");
        return;
      }
      if (state.mode === "close") {
        socket.destroy();
        return;
      }
    }
    // INSTREAM chunks: 4-byte big-endian length, then data; length 0 ends the stream.
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (length === 0) {
        state.scans += 1;
        if (state.mode === "hang") return;
        if (state.mode === "error") {
          socket.end("INSTREAM size limit exceeded. ERROR\0");
          return;
        }
        const infected = received.includes(FAKE_MALWARE_MARKER);
        socket.end(infected ? `stream: ${FAKE_SIGNATURE} FOUND\0` : "stream: OK\0");
        return;
      }
      if (buffer.length < 4 + length) return;
      received = Buffer.concat([received, buffer.subarray(4, 4 + length)]);
      buffer = buffer.subarray(4 + length);
    }
  });
}

/** Starts the fake scanner on `port` (0: any free port, reported in `port`). */
export async function startFakeClamd(port = 0, host = "127.0.0.1"): Promise<FakeClamd> {
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  const state: FakeClamd = {
    port: 0,
    mode: "ok",
    scans: 0,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        if (server)
          server.close(() => {
            resolve();
          });
        else resolve();
      }),
  };
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    handle(socket, state);
  });
  const listening = server;
  await new Promise<void>((resolve, reject) => {
    listening.once("error", reject);
    listening.listen(port, host, () => {
      resolve();
    });
  });
  const address = server.address();
  state.port = typeof address === "object" && address ? address.port : port;
  return state;
}
