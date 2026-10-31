import type { Config } from "../config/env.js";
import type { Database } from "../lib/database.js";
import { AlertService } from "./alerts/alert-service.js";
import { AuditService } from "./audit/audit-service.js";
import { AuthService } from "./auth/auth-service.js";
import { BillingService } from "./billing/billing-service.js";
import { CalendarService } from "./calendar/calendar-service.js";
import { NotificationService } from "./calendar/notifications.js";
import { ClamdScanner, type MalwareScanner } from "./documents/clamd.js";
import { DocumentService } from "./documents/document-service.js";
import { DocumentStorage } from "./documents/storage.js";
import { BreakGlassService } from "./matters/break-glass.js";
import { MatterService } from "./matters/matter-service.js";

export type ServiceConfig = ConstructorParameters<typeof AuthService>[1] &
  Pick<Config, "documents" | "clamav">;

/**
 * Every service the API uses, wired to one database client. The malware
 * scanner can be replaced (tests use a fake clamd over the same protocol).
 * Call `storage.init()` before serving requests.
 */
export function createServices(
  db: Database,
  config: ServiceConfig,
  options: { scanner?: MalwareScanner } = {},
) {
  const auth = new AuthService(db, config);
  const storage = new DocumentStorage(config.documents.storageDir);
  const scanner = options.scanner ?? new ClamdScanner(config.clamav);
  return {
    auth,
    storage,
    matters: new MatterService(db, auth.limiter),
    breakGlass: new BreakGlassService(db),
    calendar: new CalendarService(db),
    billing: new BillingService(db),
    audit: new AuditService(db),
    alerts: new AlertService(db),
    notifications: new NotificationService(db),
    documents: new DocumentService(db, storage, scanner, auth.limiter, {
      maxUploadBytes: config.documents.maxUploadBytes,
    }),
  };
}

export type Services = ReturnType<typeof createServices>;
