import { PrismaPg } from "@prisma/adapter-pg";
import type { Config } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

export type Database = InstanceType<typeof PrismaClient>;

/** Connects as the least-privilege application role from DATABASE_URL. */
export function createDatabase(config: Pick<Config, "databaseUrl" | "databasePoolMax">): Database {
  const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "lexora-api",
  });
  return new PrismaClient({ adapter });
}

/** Answers "can the API reach the database right now?" within a time limit. */
export interface DatabaseProbe {
  isReachable(): Promise<boolean>;
}

export function createDatabaseProbe(db: Database, timeoutMs = 2_000): DatabaseProbe {
  return {
    async isReachable() {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      });
      try {
        const query = db.$queryRaw`SELECT 1`.then(
          () => true,
          () => false,
        );
        return await Promise.race([query, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
