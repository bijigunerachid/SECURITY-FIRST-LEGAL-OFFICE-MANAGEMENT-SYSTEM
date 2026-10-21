// Starts the fake malware scanner used by the end-to-end tests, on
// CLAMAV_HOST:CLAMAV_PORT from .env.test. It speaks clamd's protocol and
// flags only a test marker (see src/test/fake-clamd.ts). Refuses to run
// outside the test environment.
//
//   npm run fake-clamd:e2e -w @lexora/api
import { loadConfig } from "../src/config/env.js";
import { startFakeClamd } from "../src/test/fake-clamd.js";

const config = loadConfig();
if (config.nodeEnv !== "test") {
  console.error("fake-clamd: refusing to run outside NODE_ENV=test.");
  process.exit(1);
}
const fake = await startFakeClamd(config.clamav.port, config.clamav.host);
console.error(`fake-clamd: listening on ${config.clamav.host}:${fake.port} (tests only).`);

const stop = () => {
  void fake.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
