import type { Database } from "../lib/database.js";
import { AuthService } from "./auth/auth-service.js";
import { BreakGlassService } from "./matters/break-glass.js";
import { MatterService } from "./matters/matter-service.js";

export type ServiceConfig = ConstructorParameters<typeof AuthService>[1];

/** Every service the API uses, wired to one database client. */
export function createServices(db: Database, config: ServiceConfig) {
  const auth = new AuthService(db, config);
  return {
    auth,
    matters: new MatterService(db, auth.limiter),
    breakGlass: new BreakGlassService(db),
  };
}

export type Services = ReturnType<typeof createServices>;
