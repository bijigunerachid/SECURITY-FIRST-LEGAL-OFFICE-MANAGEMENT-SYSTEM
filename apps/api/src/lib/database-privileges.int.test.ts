import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the running API's database role is least-privilege. These tests use
 * the same credentials as the API (DATABASE_URL in .env.test).
 */

const appUrl = process.env["DATABASE_URL"] ?? "";
const client = new pg.Client({ connectionString: appUrl });

/** SQLSTATE 42501 = insufficient_privilege. */
async function expectPermissionDenied(sql: string): Promise<void> {
  await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
}

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("application database role", () => {
  it("is the dedicated application role, not a superuser", async () => {
    const { rows } = await client.query<{ user: string; superuser: string }>(
      "SELECT current_user AS user, current_setting('is_superuser') AS superuser",
    );
    expect(rows[0]).toEqual({ user: "lexora_app", superuser: "off" });
  });

  it("cannot create, alter or drop schema objects", async () => {
    await expectPermissionDenied("CREATE TABLE attacker_table (id int)");
    await expectPermissionDenied("CREATE SCHEMA attacker_schema");
    await expectPermissionDenied(
      "CREATE FUNCTION attacker_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    );
  });

  it("cannot create roles or databases", async () => {
    await expectPermissionDenied("CREATE ROLE attacker_role");
    await expectPermissionDenied("CREATE DATABASE attacker_db");
  });

  it("cannot read or rewrite migration history", async () => {
    await expectPermissionDenied('SELECT * FROM "_prisma_migrations"');
    await expectPermissionDenied('DELETE FROM "_prisma_migrations"');
  });

  it("cannot read server files or run programs", async () => {
    await expectPermissionDenied("SELECT pg_read_file('/etc/passwd')");
    await expectPermissionDenied("COPY (SELECT 1) TO PROGRAM 'id'");
  });

  it("has query and idle-transaction time limits", async () => {
    const statement = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");
    const idle = await client.query<{ idle_in_transaction_session_timeout: string }>(
      "SHOW idle_in_transaction_session_timeout",
    );
    expect(statement.rows[0]?.statement_timeout).toBe("30s");
    expect(idle.rows[0]?.idle_in_transaction_session_timeout).toBe("1min");
  });

  it("cannot connect to databases it was not granted", async () => {
    const other = new URL(appUrl);
    other.pathname = "/lexora_shadow";
    const intruder = new pg.Client({ connectionString: other.toString() });
    await expect(intruder.connect()).rejects.toMatchObject({ code: "42501" });
    await intruder.end().catch(() => undefined);
  });
});
