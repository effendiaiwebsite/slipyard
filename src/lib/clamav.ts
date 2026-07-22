import net from "node:net";
import { env } from "@/lib/env";

/**
 * ClamAV scanning over clamd's TCP protocol (INSTREAM). The scanner is the
 * gate between quarantine and vault: only a 'clean' verdict promotes an
 * object (src/lib/documents.ts). Connectivity problems throw
 * ClamAvUnavailableError — callers mark the document scan_failed (retryable)
 * and NEVER treat it as clean.
 *
 * Dev: docker compose up -d clamav (host port 3310).
 */

export type ScanVerdict =
  | { verdict: "clean" }
  | { verdict: "infected"; signature: string };

export class ClamAvUnavailableError extends Error {
  constructor(message: string) {
    super(`ClamAV unavailable: ${message}`);
    this.name = "ClamAvUnavailableError";
  }
}

const CHUNK_SIZE = 64 * 1024;
const SCAN_TIMEOUT_MS = 60_000;

/**
 * Stream a buffer to clamd. Protocol: "zINSTREAM\0", then length-prefixed
 * (uint32 BE) chunks, then a zero-length chunk; reply ends with "stream: OK"
 * or "stream: <signature> FOUND".
 */
export function scanBuffer(data: Buffer): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
    let reply = "";
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new ClamAvUnavailableError(message));
    };

    socket.setTimeout(SCAN_TIMEOUT_MS, () => fail("scan timed out"));
    socket.on("error", (e) => fail(e.message));

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.subarray(offset, offset + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });

    socket.on("data", (d) => {
      reply += d.toString("utf8");
    });

    socket.on("end", () => {
      if (settled) return;
      settled = true;
      const text = reply.replace(/\0/g, "").trim();
      if (/\bOK$/.test(text)) return resolve({ verdict: "clean" });
      const found = text.match(/stream: (.+) FOUND$/);
      if (found) return resolve({ verdict: "infected", signature: found[1] });
      // Anything else (e.g. "INSTREAM size limit exceeded ERROR") is a scan
      // failure, not a verdict.
      reject(new ClamAvUnavailableError(text || "empty reply"));
    });
  });
}

/** Health probe for setup checks and tests. */
export async function pingClamAv(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
    let reply = "";
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (d) => (reply += d.toString("utf8")));
    socket.on("end", () => resolve(reply.includes("PONG")));
  });
}
