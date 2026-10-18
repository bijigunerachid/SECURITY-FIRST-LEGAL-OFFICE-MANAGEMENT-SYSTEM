// Runs the Prisma CLI with variables from one explicit env file.
//
//   node scripts/prisma-with-env.mjs <env-file> <prisma arguments...>
//
// The env file is required and must exist, so a migration meant for the test
// database can never run against another one because a file was missing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const [envFile, ...prismaArgs] = process.argv.slice(2);

if (!envFile || prismaArgs.length === 0) {
  console.error("Usage: node scripts/prisma-with-env.mjs <env-file> <prisma arguments...>");
  process.exit(2);
}
if (!existsSync(envFile)) {
  console.error(
    `Env file "${envFile}" not found. Run "npm run setup:dev" from the repository root.`,
  );
  process.exit(2);
}

process.loadEnvFile(envFile);

const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, ...prismaArgs], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
