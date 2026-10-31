// Runs `npm audit` and fails on any advisory, at any severity, except those
// listed in audit-exceptions.json with a reason and an expiry date. An
// exception past its expiry fails the check again, so it is re-examined.
// Documented in docs/security.md ("Supply chain").
//
//   npm run audit:deps
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const exceptions = JSON.parse(
  readFileSync(new URL("../audit-exceptions.json", import.meta.url), "utf8"),
).exceptions;
const today = new Date().toISOString().slice(0, 10);

let report;
try {
  // A fixed command (no user input), so running it through the shell is safe on every platform.
  report = execSync("npm audit --json", { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds anything; its JSON is still on stdout.
  report = error.stdout;
}
const vulnerabilities = JSON.parse(report).vulnerabilities ?? {};

// Every advisory found, by its GHSA ID.
const found = new Map();
for (const vulnerability of Object.values(vulnerabilities)) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object") continue;
    const id = /GHSA-[\w-]+$/.exec(via.url)?.[0] ?? via.url;
    found.set(id, `${via.name}: ${via.title} (${via.severity}) ${via.url}`);
  }
}

let failed = false;
for (const [id, text] of found) {
  const exception = exceptions.find((e) => e.advisory === id);
  if (!exception) {
    console.error(`advisory: ${text}`);
    failed = true;
  } else if (exception.expires < today) {
    console.error(`expired exception (${exception.expires}), re-examine: ${text}`);
    failed = true;
  } else {
    console.log(`accepted until ${exception.expires}: ${text}`);
  }
}
if (failed) process.exit(1);
console.log(
  `npm audit: no advisories outside the ${String(exceptions.length)} documented exception(s).`,
);
