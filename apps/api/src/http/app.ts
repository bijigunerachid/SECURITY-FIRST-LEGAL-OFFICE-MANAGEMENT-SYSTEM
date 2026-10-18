import express, { type Express } from "express";
import type { Config } from "../config/env.js";
import type { DatabaseProbe } from "../lib/database.js";
import type { Logger } from "../lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { noStore, requireJsonBody, securityHeaders } from "./middleware/security.js";
import { healthRouter } from "./routes/health.js";

/** Largest JSON body accepted. File uploads will use their own limit. */
export const JSON_BODY_LIMIT = "100kb";

export interface AppDependencies {
  config: Pick<Config, "trustProxy">;
  logger: Logger;
  database: DatabaseProbe;
}

export function createApp({ config, logger, database }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("query parser", "simple");

  app.use(requestLogger(logger));
  app.use(securityHeaders());
  app.use(noStore);
  app.use(requireJsonBody);
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true, type: "application/json" }));

  const api = express.Router();
  api.use("/health", healthRouter(database));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
