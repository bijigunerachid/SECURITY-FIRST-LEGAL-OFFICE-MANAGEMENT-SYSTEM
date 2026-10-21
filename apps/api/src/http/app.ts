import express, { type Express } from "express";
import type { Config } from "../config/env.js";
import type { DatabaseProbe } from "../lib/database.js";
import type { Logger } from "../lib/logger.js";
import type { AuthService } from "../modules/auth/auth-service.js";
import type { BreakGlassService } from "../modules/matters/break-glass.js";
import type { MatterService } from "../modules/matters/matter-service.js";
import { csrfProtection, loadSession, requireSession } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { noStore, requireJsonBody, securityHeaders } from "./middleware/security.js";
import { adminUsersRouter } from "./routes/admin-users.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import {
  breakGlassRouter,
  clientsRouter,
  conflictsRouter,
  mattersRouter,
} from "./routes/matters.js";

/** Largest JSON body accepted. File uploads will use their own limit. */
export const JSON_BODY_LIMIT = "100kb";

export interface AppDependencies {
  config: Pick<Config, "trustProxy" | "appOrigin">;
  logger: Logger;
  database: DatabaseProbe;
  auth: AuthService;
  matters: MatterService;
  breakGlass: BreakGlassService;
}

export function createApp({
  config,
  logger,
  database,
  auth,
  matters,
  breakGlass,
}: AppDependencies): Express {
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
  // Public: health checks only.
  api.use("/health", healthRouter(database));

  api.use(loadSession(auth.sessions));
  api.use(csrfProtection(config.appOrigin));
  // Sign-in routes declare which session states each accepts.
  api.use("/auth", authRouter(auth));

  // Everything below requires a fully signed-in session. Unknown routes also
  // answer 401 to anonymous callers, so routes cannot be discovered by probing.
  api.use(requireSession());
  api.use("/admin/users", adminUsersRouter(auth));
  api.use("/clients", clientsRouter(matters));
  api.use("/matters", mattersRouter(matters));
  api.use("/conflicts", conflictsRouter(matters));
  api.use("/break-glass", breakGlassRouter(breakGlass));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
