-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'lawyer', 'assistant');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('success', 'failure', 'denied');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "role" "Role" NOT NULL,
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "reauthenticated_at" TIMESTAMPTZ(3),
    "csrf_token" VARCHAR(64) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_factor" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "key_id" VARCHAR(16) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_factor_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_token" (
    "id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "issued_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "password_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_bucket" (
    "key" VARCHAR(128) NOT NULL,
    "count" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32),
    "target_id" VARCHAR(64),
    "outcome" "AuditOutcome" NOT NULL,
    "request_id" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "metadata" JSONB,
    "prev_hash" BYTEA NOT NULL,
    "hash" BYTEA NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_code_hash_key" ON "recovery_code"("code_hash");

-- CreateIndex
CREATE INDEX "recovery_code_user_id_idx" ON "recovery_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_token_token_hash_key" ON "password_token"("token_hash");

-- CreateIndex
CREATE INDEX "password_token_user_id_idx" ON "password_token"("user_id");

-- CreateIndex
CREATE INDEX "rate_limit_bucket_reset_at_idx" ON "rate_limit_bucket"("reset_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_hash_key" ON "audit_event"("hash");

-- CreateIndex
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_idx" ON "audit_event"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_event_action_idx" ON "audit_event"("action");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_factor" ADD CONSTRAINT "totp_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_token" ADD CONSTRAINT "password_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_token" ADD CONSTRAINT "password_token_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written hardening (not expressible in schema.prisma). Reviewed.
-- ---------------------------------------------------------------------------

-- Data integrity.
ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_email_normalized" CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1),
  ADD CONSTRAINT "app_user_display_name_not_blank" CHECK (btrim("display_name") <> '');
ALTER TABLE "session"
  ADD CONSTRAINT "session_token_hash_length" CHECK (octet_length("token_hash") = 32),
  ADD CONSTRAINT "session_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "recovery_code"
  ADD CONSTRAINT "recovery_code_hash_length" CHECK (octet_length("code_hash") = 32);
ALTER TABLE "password_token"
  ADD CONSTRAINT "password_token_hash_length" CHECK (octet_length("token_hash") = 32),
  ADD CONSTRAINT "password_token_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "rate_limit_bucket"
  ADD CONSTRAINT "rate_limit_bucket_count_positive" CHECK ("count" > 0);
ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_hash_length" CHECK (octet_length("hash") = 32 AND octet_length("prev_hash") = 32);

-- Accounts are disabled, never deleted, so audit history keeps its meaning.
REVOKE DELETE ON TABLE "app_user" FROM lexora_app;

-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_event" FROM lexora_app;

-- Defence in depth: refuse UPDATE and DELETE on the audit log from any role.
-- The schema owner could drop this trigger; the hash chain still reveals
-- changes made that way (see docs/security.md, "Audit logging").
CREATE FUNCTION "audit_event_is_append_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "audit_event_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_is_append_only"();
