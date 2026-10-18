-- Baseline privileges.
--
-- Prisma creates "_prisma_migrations" as the schema owner before running this
-- file, and the owner's default privileges would give the application role
-- read and write access to it. The application must not be able to read or
-- rewrite migration history.
--
-- The table does not exist in the shadow database Prisma uses to check new
-- migrations, so the statement runs only where the table is present.
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM lexora_app;
  END IF;
END
$$;
