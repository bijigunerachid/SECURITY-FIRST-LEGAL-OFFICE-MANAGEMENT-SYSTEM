import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the production build of the web app (`vite preview`,
 * which sends the production security headers) against the real API, which
 * uses the test database. Build first: `npm run build` from the repository root.
 *
 * Global set-up reseeds the test database with synthetic accounts
 * (apps/api/scripts/e2e-accounts.json). The `setup` project signs each role
 * in once and saves the browser state, so the other tests do not each sign
 * in (which would also run into the real per-IP login rate limit).
 */
/**
 * Ports can be moved when 3000/4173 are taken by something else on this
 * machine: E2E_API_PORT and E2E_WEB_PORT. CI uses the defaults.
 */
const apiPort = process.env["E2E_API_PORT"] ?? "3000";
const webPort = process.env["E2E_WEB_PORT"] ?? "4173";
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  globalSetup: "./e2e/global-setup.ts",
  // Tests within a file run in order (they share an account's session);
  // files run in parallel.
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    locale: "fr-MA",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      name: "phone",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: [
    {
      command: "npm run start:e2e -w @lexora/api",
      // Variables already set take precedence over .env.test.
      env: { PORT: apiPort, APP_ORIGIN: webOrigin },
      // Wait until the API reports ready (database reachable), as a load
      // balancer or Docker health check would.
      url: `http://127.0.0.1:${apiPort}/api/health/ready`,
      cwd: "../..",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run preview -w @lexora/web -- --port ${webPort}`,
      env: { LEXORA_API_URL: `http://127.0.0.1:${apiPort}` },
      url: webOrigin,
      cwd: "../..",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
