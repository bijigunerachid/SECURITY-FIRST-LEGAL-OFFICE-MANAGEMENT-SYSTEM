-- ---------------------------------------------------------------------------
-- Gap-free numbering enforced by the database, not only by the application.
-- Hand-written and reviewed; kept apart from the generated billing migration.
--
-- 1. Invoices and credit notes start as drafts.
-- 2. A counter starts at 1 and only ever moves up by one.
-- 3. A draft becomes issued only with the number its counter holds right now
--    (series and office year of the issue date), and numbers are unique.
--
-- Together: every number handed out is the next one of its series, at most
-- once. A counter step without an issued invoice can only come from a
-- transaction that rolled back, which undoes the step too.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "invoice_counter_steps_by_one"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."last_value" <> 1 THEN
      RAISE EXCEPTION 'a counter starts at 1' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."series" <> OLD."series" OR NEW."year" <> OLD."year" OR NEW."last_value" <> OLD."last_value" + 1 THEN
    RAISE EXCEPTION 'a counter only moves up by one' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_counter_steps_by_one"
  BEFORE INSERT OR UPDATE ON "invoice_counter"
  FOR EACH ROW EXECUTE FUNCTION "invoice_counter_steps_by_one"();

CREATE FUNCTION "invoice_numbered_from_counter"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  wanted_series text;
  expected text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'invoices are created as drafts' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'draft' AND NEW."status" = 'issued' THEN
    wanted_series := CASE NEW."kind" WHEN 'invoice' THEN 'F' ELSE 'AV' END;
    -- At least four digits; lpad alone would cut 10000 down to 1000.
    SELECT wanted_series || '-' || c."year" || '-'
             || lpad(c."last_value"::text, greatest(4, length(c."last_value"::text)), '0')
      INTO expected
      FROM "invoice_counter" c
      WHERE c."series" = wanted_series AND c."year" = extract(year FROM NEW."issued_on")::int;
    IF expected IS NULL OR NEW."number" IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'an invoice is issued with the next number of its series' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "invoice_numbered_from_counter"
  BEFORE INSERT OR UPDATE ON "invoice"
  FOR EACH ROW EXECUTE FUNCTION "invoice_numbered_from_counter"();
