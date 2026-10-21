import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { createDatabase, createDatabaseProbe } from "../lib/database.js";
import { createServices } from "../modules/services.js";
import { memoryLogger } from "../test/helpers.js";
import { createApp } from "./app.js";

const config = loadConfig(process.env);
const db = createDatabase(config);
const services = createServices(db, config);

/** Same credentials, but a port where nothing listens. */
const deadUrl = new URL(config.databaseUrl);
deadUrl.port = "1";
const deadDb = createDatabase({ ...config, databaseUrl: deadUrl.toString() });

afterAll(async () => {
  await db.$disconnect();
  await deadDb.$disconnect();
});

describe("readiness against a real PostgreSQL", () => {
  it("is ready when the database answers", async () => {
    const app = createApp({
      config,
      logger: memoryLogger().logger,
      database: createDatabaseProbe(db),
      ...services,
    });
    const res = await request(app).get("/api/health/ready").expect(200);
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  it("answers 503 quickly, without details, when the database cannot be reached", async () => {
    const log = memoryLogger();
    const app = createApp({
      config,
      logger: log.logger,
      database: createDatabaseProbe(deadDb, 1_000),
      ...services,
    });

    const started = Date.now();
    const res = await request(app).get("/api/health/ready").expect(503);
    expect(Date.now() - started).toBeLessThan(5_000);

    expect(res.body).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
    // Neither the response nor the logs may reveal the connection string.
    const password = decodeURIComponent(deadUrl.password);
    expect(JSON.stringify(res.body)).not.toContain(password);
    expect(log.raw()).not.toContain(password);
  });
});
