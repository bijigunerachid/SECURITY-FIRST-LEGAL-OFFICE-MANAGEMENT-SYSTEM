import type { LivenessResponse, ReadinessResponse } from "@lexora/shared";
import { Router } from "express";
import type { DatabaseProbe } from "../../lib/database.js";

/**
 * Health endpoints are public, so they reveal only "ok" or "unavailable":
 * no versions, host names, timings or error messages.
 *
 * - `/live`: the process is running (used to restart a stuck container).
 * - `/ready`: the API can serve requests, including reaching the database.
 */
export function healthRouter(database: DatabaseProbe): Router {
  const router = Router();

  router.get("/live", (_req, res) => {
    const body: LivenessResponse = { status: "ok" };
    res.json(body);
  });

  router.get("/ready", async (req, res) => {
    const databaseOk = await database.isReachable();
    if (!databaseOk) {
      req.log.error("readiness check failed: database unreachable");
    }
    const body: ReadinessResponse = {
      status: databaseOk ? "ok" : "unavailable",
      checks: { database: databaseOk ? "ok" : "unavailable" },
    };
    res.status(databaseOk ? 200 : 503).json(body);
  });

  return router;
}
