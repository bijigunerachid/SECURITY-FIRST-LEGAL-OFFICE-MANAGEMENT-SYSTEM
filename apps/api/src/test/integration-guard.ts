// Runs before every integration test file. Refuses to run against anything
// but a dedicated test database, because integration tests write data.

const url = process.env["DATABASE_URL"];

if (url === undefined || url === "") {
  throw new Error(
    "Integration tests need apps/api/.env.test. Run `npm run setup:dev` from the repository root.",
  );
}

const databaseName = new URL(url).pathname.slice(1);
if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run integration tests against database "${databaseName}": its name must end in "_test".`,
  );
}
if (process.env["NODE_ENV"] !== "test") {
  throw new Error("Integration tests require NODE_ENV=test.");
}
