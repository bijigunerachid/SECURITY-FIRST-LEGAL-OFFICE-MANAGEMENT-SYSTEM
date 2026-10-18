import { defineConfig } from "prisma/config";

// Prisma CLI configuration. Used only by migration commands, which run as the
// schema owner role. The running API never uses this file or that role.
//
// Environment variables are loaded by scripts/prisma-with-env.mjs, so that a
// command can never silently fall back to the wrong environment's database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    ...(process.env["MIGRATION_DATABASE_URL"] === undefined
      ? {}
      : { url: process.env["MIGRATION_DATABASE_URL"] }),
    ...(process.env["SHADOW_DATABASE_URL"] === undefined
      ? {}
      : { shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"] }),
  },
});
