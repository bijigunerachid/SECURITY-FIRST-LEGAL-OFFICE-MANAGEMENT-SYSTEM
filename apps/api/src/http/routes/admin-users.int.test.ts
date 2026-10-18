import { adminUserListResponseSchema, createUserResponseSchema } from "@lexora/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  createTestUser,
  integrationContext,
  PASSWORD,
  resetDatabase,
  type IntegrationContext,
  type TestUser,
} from "../../test/integration.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await integrationContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

/** A fully signed-in administrator (with second factor) who has just re-entered the password. */
async function adminBrowser(): Promise<{ admin: TestUser; browser: Browser }> {
  const admin = await createTestUser(ctx, { role: "admin", mfa: true });
  const browser = new Browser(ctx);
  await browser.signIn(admin);
  expect((await browser.reauth(admin)).status).toBe(204);
  return { admin, browser };
}

const NEW_USER = {
  email: "nadia.benali@cabinet.test",
  displayName: "Nadia Benali",
  role: "assistant",
};

describe("who can reach user administration", () => {
  it("is invisible (404) to lawyers and assistants, for every method", async () => {
    for (const role of ["lawyer", "assistant"] as const) {
      const user = await createTestUser(ctx, { role });
      const browser = new Browser(ctx);
      await browser.signIn(user);
      await browser.reauth(user);
      const target = await createTestUser(ctx);
      const attempts = [
        browser.send("get", "/api/admin/users"),
        browser.send("post", "/api/admin/users", NEW_USER),
        browser.send("patch", `/api/admin/users/${target.id}`, { role: "admin" }),
        browser.send("post", `/api/admin/users/${target.id}/password-token`),
        browser.send("post", `/api/admin/users/${target.id}/mfa-reset`),
        browser.send("post", `/api/admin/users/${target.id}/sessions/revoke`),
        // A lawyer cannot promote themselves either.
        browser.send("patch", `/api/admin/users/${user.id}`, { role: "admin" }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.status).toBe(404);
      }
      expect((await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(role);
    }
  });

  it("requires a session (401 when signed out)", async () => {
    expect((await new Browser(ctx).send("get", "/api/admin/users")).status).toBe(401);
  });

  it("requires a recent re-entry of the password for every change", async () => {
    const admin = await createTestUser(ctx, { role: "admin", mfa: true });
    const browser = new Browser(ctx);
    await browser.signIn(admin);

    expect((await browser.send("get", "/api/admin/users")).status).toBe(200);
    const before = await browser.send("post", "/api/admin/users", NEW_USER);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe("reauthentication_required");

    // Password alone is not enough when the account has a second factor.
    const passwordOnly = await browser.send("post", "/api/auth/reauth", {
      password: admin.password,
    });
    expect(passwordOnly.status).toBe(400);
    expect((await browser.reauth(admin)).status).toBe(204);
    expect((await browser.send("post", "/api/admin/users", NEW_USER)).status).toBe(201);

    // The re-entry is valid for five minutes only.
    await ctx.owner.query(
      "UPDATE session SET reauthenticated_at = now() - interval '6 minutes' WHERE user_id = $1",
      [admin.id],
    );
    expect(
      (await browser.send("post", "/api/admin/users", { ...NEW_USER, email: "other@cabinet.test" }))
        .status,
    ).toBe(403);
  });
});

describe("creating users and password links", () => {
  it("creates a user without a password and returns a single-use setup link once", async () => {
    const { browser } = await adminBrowser();
    const res = await browser.send("post", "/api/admin/users", NEW_USER);
    expect(res.status).toBe(201);
    const { user, setup } = createUserResponseSchema.parse(res.body);
    expect(user).toMatchObject({
      email: NEW_USER.email,
      role: "assistant",
      hasPassword: false,
      mfaEnabled: false,
    });

    // The new user cannot sign in until the password is set.
    expect(
      (
        await new Browser(ctx).send("post", "/api/auth/login", {
          email: NEW_USER.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(401);

    // A rejected password does not use up the link.
    const weak = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: setup.token,
      password: "nadia benali password",
    });
    expect(weak.body.error).toMatchObject({
      code: "password_rejected",
      reason: "contains_personal_info",
    });

    const ok = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: setup.token,
      password: PASSWORD,
    });
    expect(ok.status).toBe(204);
    expect(
      (
        await new Browser(ctx).send("post", "/api/auth/login", {
          email: NEW_USER.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);

    const reuse = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: setup.token,
      password: "another long passphrase here",
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("invalid_token");
  });

  it("refuses duplicate e-mail addresses, whatever their case", async () => {
    const { browser } = await adminBrowser();
    await browser.send("post", "/api/admin/users", NEW_USER);
    const dup = await browser.send("post", "/api/admin/users", {
      ...NEW_USER,
      email: NEW_USER.email.toUpperCase(),
    });
    expect(dup.status).toBe(409);
  });

  it("rejects fields that are not allowed (no mass assignment)", async () => {
    const { browser } = await adminBrowser();
    for (const extra of [{ passwordHash: "x" }, { id: randomUUID() }, { disabledAt: null }]) {
      const res = await browser.send("post", "/api/admin/users", { ...NEW_USER, ...extra });
      expect(res.status).toBe(400);
    }
    const target = await createTestUser(ctx);
    const patch = await browser.send("patch", `/api/admin/users/${target.id}`, {
      email: "changed@cabinet.test",
    });
    expect(patch.status).toBe(400);
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: target.id } })).email).toBe(
      target.email,
    );
  });

  it("makes links expire after 30 minutes and invalidates older links when a new one is issued", async () => {
    const { browser } = await adminBrowser();
    const target = await createTestUser(ctx);
    const first = (await browser.send("post", `/api/admin/users/${target.id}/password-token`)).body
      .token as string;
    const second = (await browser.send("post", `/api/admin/users/${target.id}/password-token`)).body
      .token as string;

    const old = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: first,
      password: "a fresh passphrase for nadia",
    });
    expect(old.body.error.code).toBe("invalid_token");

    await ctx.owner.query(
      "UPDATE password_token SET created_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [target.id],
    );
    const expired = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: second,
      password: "a fresh passphrase for nadia",
    });
    expect(expired.body.error.code).toBe("invalid_token");
  });

  it("signs the user out everywhere when a link is used", async () => {
    const { browser } = await adminBrowser();
    const target = await createTestUser(ctx);
    const targetBrowser = new Browser(ctx);
    await targetBrowser.signIn(target);
    const token = (await browser.send("post", `/api/admin/users/${target.id}/password-token`)).body
      .token as string;
    const set = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token,
      password: "a fresh passphrase for the clerk",
    });
    expect(set.status).toBe(204);
    expect((await targetBrowser.send("get", "/api/auth/session")).status).toBe(401);
  });
});

describe("changing users", () => {
  it("revokes the user's sessions when their role changes or they are disabled", async () => {
    const { browser } = await adminBrowser();
    for (const change of [{ role: "assistant" }, { disabled: true }]) {
      const target = await createTestUser(ctx, { role: "lawyer" });
      const targetBrowser = new Browser(ctx);
      await targetBrowser.signIn(target);
      expect((await browser.send("patch", `/api/admin/users/${target.id}`, change)).status).toBe(
        204,
      );
      expect((await targetBrowser.send("get", "/api/auth/session")).status).toBe(401);
    }
  });

  it("does not let administrators demote or disable themselves", async () => {
    const { admin, browser } = await adminBrowser();
    await createTestUser(ctx, { role: "admin", mfa: true });
    expect(
      (await browser.send("patch", `/api/admin/users/${admin.id}`, { role: "lawyer" })).status,
    ).toBe(409);
    expect(
      (await browser.send("patch", `/api/admin/users/${admin.id}`, { disabled: true })).status,
    ).toBe(409);
    // Changing their own display name is fine.
    expect(
      (await browser.send("patch", `/api/admin/users/${admin.id}`, { displayName: "New Name" }))
        .status,
    ).toBe(204);
  });

  it("never ends up with no administrator, even when two demote each other at once", async () => {
    for (let round = 0; round < 5; round++) {
      await resetDatabase(ctx);
      const a = await createTestUser(ctx, { role: "admin", mfa: true });
      const b = await createTestUser(ctx, { role: "admin", mfa: true });
      const browserA = new Browser(ctx);
      const browserB = new Browser(ctx);
      await browserA.signIn(a);
      await browserB.signIn(b);
      await browserA.reauth(a);
      await browserB.reauth(b);

      const [resA, resB] = await Promise.all([
        browserA.send("patch", `/api/admin/users/${b.id}`, { role: "lawyer" }),
        browserB.send("patch", `/api/admin/users/${a.id}`, { role: "lawyer" }),
      ]);
      const statuses = [resA.status, resB.status].sort();
      // One demotion succeeds; the other is refused because its author is no
      // longer an administrator (404) or would remove the last one (409).
      expect(statuses[0]).toBe(204);
      expect([404, 409]).toContain(statuses[1]);
      expect(await ctx.db.user.count({ where: { role: "admin", disabledAt: null } })).toBe(1);
    }
  });

  it("answers 404 for malformed and unknown user IDs", async () => {
    const { browser } = await adminBrowser();
    for (const id of ["not-a-uuid", "1 OR 1=1", randomUUID()]) {
      expect(
        (
          await browser.send("patch", `/api/admin/users/${encodeURIComponent(id)}`, {
            displayName: "x",
          })
        ).status,
      ).toBe(404);
    }
  });

  it("resets another user's second factor and signs them out", async () => {
    const { browser } = await adminBrowser();
    const target = await createTestUser(ctx, { role: "admin", mfa: true });
    const targetBrowser = new Browser(ctx);
    await targetBrowser.signIn(target);

    expect((await browser.send("post", `/api/admin/users/${target.id}/mfa-reset`)).status).toBe(
      204,
    );
    expect((await targetBrowser.send("get", "/api/auth/session")).status).toBe(401);
    // The administrator must set up a new second factor at next sign-in.
    expect((await new Browser(ctx).login(target.email, PASSWORD)).body.state).toBe(
      "mfa_setup_required",
    );
  });

  it("lists users without exposing secrets", async () => {
    const { browser } = await adminBrowser();
    await createTestUser(ctx, { mfa: true });
    const res = await browser.send("get", "/api/admin/users");
    const { users } = adminUserListResponseSchema.parse(res.body);
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|secret|token/i);
  });
});
