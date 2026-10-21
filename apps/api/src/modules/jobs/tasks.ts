import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "../../lib/database.js";
import type { SessionStore } from "../auth/sessions.js";
import type { RateLimiter } from "../auth/rate-limit.js";
import { generateReminders } from "../calendar/notifications.js";
import type { PeriodicTask } from "./scheduler.js";

/** A quarantined upload older than this was abandoned (uploads take seconds). */
export const QUARANTINE_MAX_AGE_MS = 60 * 60_000;

/** The worker's periodic tasks. Names match the rows created by migrations. */
export function periodicTasks(deps: {
  db: Database;
  sessions: SessionStore;
  limiter: RateLimiter;
  storageDir: string;
}): PeriodicTask[] {
  return [
    {
      name: "reminders",
      run: async (now) => `${String(await generateReminders(deps.db, now))} reminders created`,
    },
    {
      name: "purge-expired",
      run: async () => {
        const sessions = await deps.sessions.purgeExpired();
        await deps.limiter.purgeExpired();
        return `${String(sessions)} expired sessions removed`;
      },
    },
    {
      // Uploads that never finished (server stopped mid-check). Files in
      // quarantine were never accepted, so removing them loses nothing.
      name: "quarantine-cleanup",
      run: async (now) => {
        const dir = join(deps.storageDir, "quarantine");
        let removed = 0;
        for (const name of await readdir(dir)) {
          const path = join(dir, name);
          const info = await stat(path);
          if (info.isFile() && now.getTime() - info.mtimeMs > QUARANTINE_MAX_AGE_MS) {
            await rm(path, { force: true });
            removed += 1;
          }
        }
        return `${String(removed)} abandoned uploads removed`;
      },
    },
  ];
}
