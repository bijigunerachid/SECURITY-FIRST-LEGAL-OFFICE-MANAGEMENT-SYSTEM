-- ---------------------------------------------------------------------------
-- Hand-written hardening for clients and matters (not expressible in
-- schema.prisma). Reviewed. Kept apart from the generated migration so that
-- each file has one author: Prisma, or a reviewer.
-- ---------------------------------------------------------------------------

-- Data integrity.
ALTER TABLE "client"
  ADD CONSTRAINT "client_name_not_blank" CHECK (btrim("name") <> '' AND btrim("search_name") <> ''),
  ADD CONSTRAINT "client_identifier_pair" CHECK (("identifier" IS NULL) = ("search_identifier" IS NULL)),
  ADD CONSTRAINT "client_email_normalized" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND position('@' IN "email") > 1));

ALTER TABLE "matter_counter"
  ADD CONSTRAINT "matter_counter_year_range" CHECK ("year" BETWEEN 2000 AND 9999),
  ADD CONSTRAINT "matter_counter_positive" CHECK ("last_value" > 0);

ALTER TABLE "matter"
  ADD CONSTRAINT "matter_reference_format" CHECK ("reference" ~ '^[0-9]{4}-[0-9]{4,6}$'),
  ADD CONSTRAINT "matter_title_not_blank" CHECK (btrim("title") <> ''),
  -- A matter is closed exactly when it has a closing date, never before it opened.
  ADD CONSTRAINT "matter_closed_consistent" CHECK (("status" = 'closed') = ("closed_on" IS NOT NULL)),
  ADD CONSTRAINT "matter_closed_after_opened" CHECK ("closed_on" IS NULL OR "closed_on" >= "opened_on");

-- Exactly one lead per matter at any time (the application keeps one present).
CREATE UNIQUE INDEX "matter_member_one_lead" ON "matter_member" ("matter_id") WHERE "role" = 'lead';

ALTER TABLE "party"
  ADD CONSTRAINT "party_name_not_blank" CHECK (btrim("name") <> '' AND btrim("search_name") <> ''),
  ADD CONSTRAINT "party_identifier_pair" CHECK (("identifier" IS NULL) = ("search_identifier" IS NULL));

ALTER TABLE "break_glass_grant"
  ADD CONSTRAINT "break_glass_grant_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 20 AND 500),
  ADD CONSTRAINT "break_glass_grant_expiry" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '4 hours'),
  ADD CONSTRAINT "break_glass_grant_ended_after_start" CHECK ("ended_at" IS NULL OR "ended_at" >= "created_at");

-- Legal history is closed or archived, never deleted by the application.
-- Team memberships and parties can be removed (each removal is audited).
REVOKE DELETE, TRUNCATE ON TABLE "client", "matter", "matter_counter", "break_glass_grant" FROM lexora_app;
-- A grant's matter, holder, reason and times cannot be rewritten; it can only be ended early.
REVOKE UPDATE ON TABLE "break_glass_grant" FROM lexora_app;
GRANT UPDATE ("ended_at") ON TABLE "break_glass_grant" TO lexora_app;
