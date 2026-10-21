-- CreateEnum
CREATE TYPE "HearingStatus" AS ENUM ('scheduled', 'held', 'postponed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('deadline', 'task');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('hearing_soon', 'deadline_soon', 'deadline_overdue', 'task_due', 'task_assigned');

-- CreateTable
CREATE TABLE "hearing" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "court" VARCHAR(200),
    "room" VARCHAR(100),
    "notes" VARCHAR(2000),
    "status" "HearingStatus" NOT NULL DEFAULT 'scheduled',
    "outcome" VARCHAR(2000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_task" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "due_on" DATE,
    "notes" VARCHAR(2000),
    "assignee_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matter_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "subject_id" UUID NOT NULL,
    "stage" VARCHAR(16) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_task" (
    "name" VARCHAR(64) NOT NULL,
    "interval_seconds" INTEGER NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "lease_until" TIMESTAMPTZ(3),
    "last_started_at" TIMESTAMPTZ(3),
    "last_finished_at" TIMESTAMPTZ(3),
    "last_status" VARCHAR(16),
    "last_summary" VARCHAR(200),

    CONSTRAINT "scheduled_task_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "hearing_matter_id_idx" ON "hearing"("matter_id");

-- CreateIndex
CREATE INDEX "hearing_starts_at_idx" ON "hearing"("starts_at");

-- CreateIndex
CREATE INDEX "matter_task_matter_id_idx" ON "matter_task"("matter_id");

-- CreateIndex
CREATE INDEX "matter_task_due_on_idx" ON "matter_task"("due_on");

-- CreateIndex
CREATE INDEX "matter_task_assignee_id_idx" ON "matter_task"("assignee_id");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_id_subject_id_stage_key" ON "notification"("user_id", "subject_id", "stage");

-- AddForeignKey
ALTER TABLE "hearing" ADD CONSTRAINT "hearing_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing" ADD CONSTRAINT "hearing_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_task" ADD CONSTRAINT "matter_task_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_task" ADD CONSTRAINT "matter_task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_task" ADD CONSTRAINT "matter_task_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_task" ADD CONSTRAINT "matter_task_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written hardening (not expressible in schema.prisma). Reviewed.
-- ---------------------------------------------------------------------------

ALTER TABLE "hearing"
  ADD CONSTRAINT "hearing_title_not_blank" CHECK (btrim("title") <> ''),
  -- An outcome only once the hearing is no longer just scheduled.
  ADD CONSTRAINT "hearing_outcome_after_scheduled" CHECK ("outcome" IS NULL OR "status" <> 'scheduled');

ALTER TABLE "matter_task"
  ADD CONSTRAINT "matter_task_title_not_blank" CHECK (btrim("title") <> ''),
  -- A deadline always has a date.
  ADD CONSTRAINT "matter_task_deadline_has_date" CHECK ("kind" <> 'deadline' OR "due_on" IS NOT NULL),
  -- Completed by someone, at some time: both or neither.
  ADD CONSTRAINT "matter_task_completed_pair" CHECK (("completed_at" IS NULL) = ("completed_by_id" IS NULL));

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_stage_format" CHECK ("stage" ~ '^[a-z0-9-]{1,16}$');

ALTER TABLE "scheduled_task"
  ADD CONSTRAINT "scheduled_task_interval_range" CHECK ("interval_seconds" BETWEEN 60 AND 604800),
  ADD CONSTRAINT "scheduled_task_status" CHECK ("last_status" IS NULL OR "last_status" IN ('ok', 'error'));

-- Hearings are part of the matter's history: cancelled, never deleted.
REVOKE DELETE, TRUNCATE ON TABLE "hearing" FROM lexora_app;
-- Notifications are marked read, never rewritten; old ones may be deleted by the worker.
REVOKE UPDATE ON TABLE "notification" FROM lexora_app;
GRANT UPDATE ("read_at") ON TABLE "notification" TO lexora_app;
-- The worker only claims and reports on tasks defined by migrations.
REVOKE INSERT, DELETE, TRUNCATE ON TABLE "scheduled_task" FROM lexora_app;
REVOKE UPDATE ON TABLE "scheduled_task" FROM lexora_app;
GRANT UPDATE ("next_run_at", "lease_until", "last_started_at", "last_finished_at", "last_status", "last_summary")
  ON TABLE "scheduled_task" TO lexora_app;

-- The periodic tasks and how often they run.
INSERT INTO "scheduled_task" ("name", "interval_seconds", "next_run_at") VALUES
  ('reminders', 900, now()),
  ('purge-expired', 900, now()),
  ('quarantine-cleanup', 3600, now());
