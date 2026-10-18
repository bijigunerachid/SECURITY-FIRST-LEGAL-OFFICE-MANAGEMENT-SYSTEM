import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const sharedSource = fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url));

/**
 * Integration tests read `.env.test` and nothing else, so they can never
 * fall back to the development database because a setting was missing.
 */
function testEnv(): Record<string, string> {
  const path = fileURLToPath(new URL(".env.test", import.meta.url));
  if (!existsSync(path)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(path, "utf8"))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

export default defineConfig({
  resolve: {
    alias: { "@lexora/shared": sharedSource },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          env: testEnv(),
          setupFiles: ["src/test/integration-guard.ts"],
          fileParallelism: false,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
