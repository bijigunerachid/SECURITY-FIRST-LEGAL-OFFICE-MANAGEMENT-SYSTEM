-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('login_failures_account', 'login_failures_ip', 'access_denied', 'break_glass', 'audit_chain', 'backup_failed', 'backup_overdue');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('high', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "security_alert" (
    "id" UUID NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "subject" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "count" INTEGER NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_alert_status_last_seen_at_idx" ON "security_alert"("status", "last_seen_at");

-- AddForeignKey
ALTER TABLE "security_alert" ADD CONSTRAINT "security_alert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alert" ADD CONSTRAINT "security_alert_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alert" ADD CONSTRAINT "security_alert_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written hardening (not expressible in schema.prisma). Reviewed.
-- ---------------------------------------------------------------------------

-- The matter history and the alert scans read the audit log by matter and by
-- recent outcome; without these they would read the whole table.
CREATE INDEX "audit_event_matter_id_idx" ON "audit_event" (("metadata" ->> 'matterId'));
CREATE INDEX "audit_event_target_idx" ON "audit_event" ("target_type", "target_id");
CREATE INDEX "audit_event_outcome_occurred_at_idx" ON "audit_event" ("outcome", "occurred_at");

ALTER TABLE "security_alert"
  ADD CONSTRAINT "security_alert_subject_not_blank" CHECK (btrim("subject") <> ''),
  ADD CONSTRAINT "security_alert_count_positive" CHECK ("count" > 0),
  ADD CONSTRAINT "security_alert_seen_order" CHECK ("last_seen_at" >= "first_seen_at"),
  -- Acknowledged and resolved by someone, at some time: both or neither.
  ADD CONSTRAINT "security_alert_acknowledged_pair" CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by_id" IS NULL)),
  ADD CONSTRAINT "security_alert_resolved_pair" CHECK (
    ("resolved_at" IS NULL) = ("resolved_by_id" IS NULL) AND ("resolved_at" IS NULL) = ("resolution_note" IS NULL)),
  ADD CONSTRAINT "security_alert_status_consistent" CHECK (
    ("status" = 'resolved') = ("resolved_at" IS NOT NULL)
    AND ("status" = 'open') = ("acknowledged_at" IS NULL AND "resolved_at" IS NULL)),
  ADD CONSTRAINT "security_alert_note_length" CHECK ("resolution_note" IS NULL OR char_length(btrim("resolution_note")) BETWEEN 5 AND 500);

-- At most one unresolved alert per kind and subject (repeats update it).
CREATE UNIQUE INDEX "security_alert_one_unresolved" ON "security_alert" ("kind", "subject") WHERE "status" <> 'resolved';
-- Alerts about one event are raised once, even after being resolved.
CREATE UNIQUE INDEX "security_alert_event_once" ON "security_alert" ("kind", "subject")
  WHERE "kind" IN ('break_glass', 'audit_chain', 'backup_failed');

-- Alerts are history: never deleted; only their counts and handling change.
REVOKE DELETE, TRUNCATE ON TABLE "security_alert" FROM lexora_app;
REVOKE UPDATE ON TABLE "security_alert" FROM lexora_app;
GRANT UPDATE ("count", "last_seen_at", "status", "acknowledged_by_id", "acknowledged_at",
              "resolved_by_id", "resolved_at", "resolution_note")
  ON TABLE "security_alert" TO lexora_app;

-- The periodic tasks: alert scan every 5 minutes, audit-chain check daily.
INSERT INTO "scheduled_task" ("name", "interval_seconds", "next_run_at") VALUES
  ('security-alerts', 300, now()),
  ('audit-verify', 86400, now());
