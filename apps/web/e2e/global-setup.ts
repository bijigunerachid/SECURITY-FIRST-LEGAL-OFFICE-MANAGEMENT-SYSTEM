import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Resets the test database and creates the synthetic accounts before every run. */
export default function globalSetup(): void {
  execSync("npm run seed:e2e -w @lexora/api", {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stdio: "inherit",
  });
}
