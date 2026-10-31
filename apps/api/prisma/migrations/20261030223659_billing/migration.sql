-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('invoice', 'credit_note');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('fee', 'disbursement');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('payment', 'refund');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'cheque', 'transfer', 'card', 'other');

-- CreateEnum
CREATE TYPE "FeeAgreementKind" AS ENUM ('fixed', 'hourly', 'other');

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "office_name" VARCHAR(200),
    "address" VARCHAR(500),
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "ice" VARCHAR(15),
    "tax_id" VARCHAR(10),
    "professional_tax_id" VARCHAR(12),
    "bar_association" VARCHAR(120),
    "bank_name" VARCHAR(120),
    "rib" VARCHAR(24),
    "vat_rate_basis_points" INTEGER NOT NULL DEFAULT 2000,
    "payment_term_days" INTEGER NOT NULL DEFAULT 30,
    "invoice_note" VARCHAR(1000),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_agreement" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "kind" "FeeAgreementKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "amount_centimes" BIGINT,
    "hourly_rate_centimes" BIGINT,
    "signed_on" DATE,
    "terms" VARCHAR(4000),
    "ended_on" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counter" (
    "series" VARCHAR(4) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "invoice_counter_pkey" PRIMARY KEY ("series","year")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "number" VARCHAR(20),
    "issued_on" DATE,
    "due_on" DATE,
    "credited_invoice_id" UUID,
    "notes" VARCHAR(2000),
    "fee_vat_rate_basis_points" INTEGER NOT NULL,
    "subtotal_centimes" BIGINT NOT NULL DEFAULT 0,
    "vat_centimes" BIGINT NOT NULL DEFAULT 0,
    "total_centimes" BIGINT NOT NULL DEFAULT 0,
    "credited_centimes" BIGINT NOT NULL DEFAULT 0,
    "received_centimes" BIGINT NOT NULL DEFAULT 0,
    "balance_centimes" BIGINT NOT NULL DEFAULT 0,
    "seller" JSONB,
    "buyer" JSONB,
    "created_by_id" UUID NOT NULL,
    "issued_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity_hundredths" INTEGER NOT NULL,
    "unit_price_centimes" BIGINT NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL,
    "net_centimes" BIGINT NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "received_on" DATE NOT NULL,
    "amount_centimes" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(100),
    "notes" VARCHAR(500),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fee_agreement_matter_id_idx" ON "fee_agreement"("matter_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE INDEX "invoice_matter_id_idx" ON "invoice"("matter_id");

-- CreateIndex
CREATE INDEX "invoice_status_issued_on_idx" ON "invoice"("status", "issued_on");

-- CreateIndex
CREATE INDEX "invoice_credited_invoice_id_idx" ON "invoice"("credited_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_invoice_id_position_key" ON "invoice_line"("invoice_id", "position");

-- CreateIndex
CREATE INDEX "payment_invoice_id_idx" ON "payment"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_received_on_idx" ON "payment"("received_on");

-- AddForeignKey
ALTER TABLE "fee_agreement" ADD CONSTRAINT "fee_agreement_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_agreement" ADD CONSTRAINT "fee_agreement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_credited_invoice_id_fkey" FOREIGN KEY ("credited_invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written hardening (not expressible in schema.prisma). Reviewed.
-- ---------------------------------------------------------------------------

-- Office billing details: one row, created here, only ever updated.
ALTER TABLE "billing_settings"
  ADD CONSTRAINT "billing_settings_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "billing_settings_vat_range" CHECK ("vat_rate_basis_points" BETWEEN 0 AND 3000),
  ADD CONSTRAINT "billing_settings_term_range" CHECK ("payment_term_days" BETWEEN 0 AND 365),
  ADD CONSTRAINT "billing_settings_office_name_not_blank" CHECK ("office_name" IS NULL OR btrim("office_name") <> ''),
  ADD CONSTRAINT "billing_settings_ice_format" CHECK ("ice" IS NULL OR "ice" ~ '^[0-9]{15}$'),
  ADD CONSTRAINT "billing_settings_tax_id_format" CHECK ("tax_id" IS NULL OR "tax_id" ~ '^[0-9]{1,10}$'),
  ADD CONSTRAINT "billing_settings_professional_tax_id_format" CHECK ("professional_tax_id" IS NULL OR "professional_tax_id" ~ '^[0-9]{1,12}$'),
  ADD CONSTRAINT "billing_settings_rib_format" CHECK ("rib" IS NULL OR "rib" ~ '^[0-9]{24}$');
INSERT INTO "billing_settings" ("id") VALUES (1);
REVOKE INSERT, DELETE, TRUNCATE ON TABLE "billing_settings" FROM lexora_app;

ALTER TABLE "fee_agreement"
  ADD CONSTRAINT "fee_agreement_title_not_blank" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "fee_agreement_amounts_positive" CHECK (coalesce("amount_centimes", 0) >= 0 AND coalesce("hourly_rate_centimes", 0) >= 0),
  ADD CONSTRAINT "fee_agreement_fixed_has_amount" CHECK ("kind" <> 'fixed' OR "amount_centimes" IS NOT NULL),
  ADD CONSTRAINT "fee_agreement_hourly_has_rate" CHECK ("kind" <> 'hourly' OR "hourly_rate_centimes" IS NOT NULL),
  ADD CONSTRAINT "fee_agreement_ended_after_signed" CHECK ("ended_on" IS NULL OR "signed_on" IS NULL OR "ended_on" >= "signed_on");
-- Agreements are part of the matter's history: ended, never deleted.
REVOKE DELETE, TRUNCATE ON TABLE "fee_agreement" FROM lexora_app;

ALTER TABLE "invoice_counter"
  ADD CONSTRAINT "invoice_counter_series" CHECK ("series" IN ('F', 'AV')),
  ADD CONSTRAINT "invoice_counter_year_range" CHECK ("year" BETWEEN 2000 AND 9999),
  ADD CONSTRAINT "invoice_counter_positive" CHECK ("last_value" > 0);
-- A counter that went back would hand out a number twice; one that was deleted would restart at 1.
REVOKE DELETE, TRUNCATE ON TABLE "invoice_counter" FROM lexora_app;

ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_number_format" CHECK (
    "number" IS NULL
    OR ("kind" = 'invoice' AND "number" ~ '^F-[0-9]{4}-[0-9]{4,6}$')
    OR ("kind" = 'credit_note' AND "number" ~ '^AV-[0-9]{4}-[0-9]{4,6}$')),
  -- A draft has no number, date, issuer or printed details; an issued document has all of them.
  ADD CONSTRAINT "invoice_issue_consistent" CHECK (
    ("status" = 'draft' AND "number" IS NULL AND "issued_on" IS NULL AND "due_on" IS NULL
      AND "issued_by_id" IS NULL AND "seller" IS NULL AND "buyer" IS NULL)
    OR ("status" = 'issued' AND "number" IS NOT NULL AND "issued_on" IS NOT NULL
      AND "issued_by_id" IS NOT NULL AND "seller" IS NOT NULL AND "buyer" IS NOT NULL
      AND "total_centimes" > 0
      AND ("kind" = 'credit_note') = ("due_on" IS NULL))),
  ADD CONSTRAINT "invoice_due_after_issue" CHECK ("due_on" IS NULL OR "due_on" >= "issued_on"),
  -- Exactly the credit notes point at the invoice they correct.
  ADD CONSTRAINT "invoice_credit_note_link" CHECK (
    ("kind" = 'credit_note') = ("credited_invoice_id" IS NOT NULL) AND "credited_invoice_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "invoice_vat_range" CHECK ("fee_vat_rate_basis_points" BETWEEN 0 AND 3000),
  ADD CONSTRAINT "invoice_totals" CHECK (
    "subtotal_centimes" >= 0 AND "vat_centimes" >= 0
    AND "total_centimes" = "subtotal_centimes" + "vat_centimes"),
  -- The running totals always add up; only issued invoices have any.
  ADD CONSTRAINT "invoice_balance" CHECK (
    "balance_centimes" = "total_centimes" - "credited_centimes" - "received_centimes"
    AND "credited_centimes" BETWEEN 0 AND "total_centimes"
    AND "received_centimes" >= 0
    AND (("status" = 'issued' AND "kind" = 'invoice') OR ("credited_centimes" = 0 AND "received_centimes" = 0)));
REVOKE TRUNCATE ON TABLE "invoice" FROM lexora_app;

ALTER TABLE "invoice_line"
  ADD CONSTRAINT "invoice_line_position_range" CHECK ("position" BETWEEN 0 AND 49),
  ADD CONSTRAINT "invoice_line_description_not_blank" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "invoice_line_amounts" CHECK (
    "quantity_hundredths" > 0 AND "unit_price_centimes" >= 0 AND "net_centimes" >= 0
    AND "vat_rate_basis_points" BETWEEN 0 AND 3000),
  ADD CONSTRAINT "invoice_line_disbursement_without_vat" CHECK ("kind" <> 'disbursement' OR "vat_rate_basis_points" = 0);
REVOKE TRUNCATE ON TABLE "invoice_line" FROM lexora_app;

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive" CHECK ("amount_centimes" > 0),
  ADD CONSTRAINT "payment_void_consistent" CHECK (
    ("voided_at" IS NULL) = ("voided_by_id" IS NULL) AND ("voided_at" IS NULL) = ("void_reason" IS NULL)),
  ADD CONSTRAINT "payment_void_reason_length" CHECK ("void_reason" IS NULL OR char_length(btrim("void_reason")) BETWEEN 5 AND 300);
-- Money received is recorded once; a mistake is voided (with who, when and why), never edited or deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "payment" FROM lexora_app;
GRANT UPDATE ("voided_at", "voided_by_id", "void_reason") ON TABLE "payment" TO lexora_app;

-- Defence in depth, for every role: an issued invoice or credit note never
-- changes except for its running totals, and is never deleted. Corrections
-- are made with a credit note.
CREATE FUNCTION "invoice_frozen_once_issued"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  running CONSTANT text[] := ARRAY['credited_centimes', 'received_centimes', 'balance_centimes', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'an issued invoice cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'issued' AND (to_jsonb(NEW) - running) IS DISTINCT FROM (to_jsonb(OLD) - running) THEN
    RAISE EXCEPTION 'an issued invoice cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_frozen_once_issued"
  BEFORE UPDATE OR DELETE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_frozen_once_issued"();

-- Lines belong to drafts only once their invoice is issued.
CREATE FUNCTION "invoice_line_only_on_drafts"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status "InvoiceStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."invoice_id" <> OLD."invoice_id" THEN
    RAISE EXCEPTION 'a line cannot move to another invoice' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status" INTO parent_status FROM "invoice"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."invoice_id" ELSE NEW."invoice_id" END;
  -- Deleting a draft removes its lines by cascade, after the draft row is gone.
  IF TG_OP = 'DELETE' AND parent_status IS NULL THEN
    RETURN OLD;
  END IF;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'the lines of an issued invoice cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "invoice_line_only_on_drafts"
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line"
  FOR EACH ROW EXECUTE FUNCTION "invoice_line_only_on_drafts"();

-- Payments go to issued invoices (not drafts, not credit notes), are voided
-- at most once, and are otherwise never changed or deleted.
CREATE FUNCTION "payment_guard"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "invoice"
                   WHERE "id" = NEW."invoice_id" AND "kind" = 'invoice' AND "status" = 'issued') THEN
      RAISE EXCEPTION 'payments are recorded against issued invoices only' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a payment cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voided_at" IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by_id', 'void_reason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by_id', 'void_reason']) THEN
    RAISE EXCEPTION 'a payment can only be voided, once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION "payment_guard"();
