import { apiErrorResponseSchema, sessionResponseSchema } from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../modules/auth/sessions.js";
import { officeUtcOffsetMinutes } from "../../modules/matters/office-date.js";
import {
  Browser,
  codeFor,
  createTestUser,
  integrationContext,
  PASSWORD,
  resetDatabase,
  type IntegrationContext,
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

describe("login", () => {
  it("gives the same answer for unknown, wrong-password, disabled and not-yet-activated accounts", async () => {
    const known = await createTestUser(ctx);
    const disabled = await createTestUser(ctx, { disabled: true });
    const pending = await createTestUser(ctx, { password: null });

    const attempts = [
      { email: "nobody@cabinet.test", password: PASSWORD },
      { email: known.email, password: "a wrong password guess" },
      { email: disabled.email, password: PASSWORD },
      { email: pending.email, password: PASSWORD },
    ];
    for (const attempt of attempts) {
      const res = await new Browser(ctx).send("post", "/api/auth/login", attempt);
      expect(res.status).toBe(401);
      expect(apiErrorResponseSchema.parse(res.body).error.code).toBe("invalid_credentials");
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("sets a hardened session cookie and reports the signed-in user", async () => {
    const user = await createTestUser(ctx);
    const browser = new Browser(ctx);
    const res = await browser.send("post", "/api/auth/login", {
      email: user.email,
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "active" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");

    const session = sessionResponseSchema.parse((await browser.refresh()).body);
    expect(session.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: "lawyer",
      mfaEnabled: false,
    });
    expect(session.state).toBe("active");
    // The office's current offset, from the server's time-zone data (the browser's may be outdated).
    expect(session.officeUtcOffsetMinutes).toBe(officeUtcOffsetMinutes());
    // The session response never carries secrets beyond the CSRF token.
    expect(JSON.stringify(session)).not.toMatch(/password|hash|secret/i);
  });

  it("normalises the e-mail address (case and spaces)", async () => {
    const user = await createTestUser(ctx);
    const res = await new Browser(ctx).send("post", "/api/auth/login", {
      email: `  ${user.email.toUpperCase()} `,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  it("replaces any existing session on login (no session fixation)", async () => {
    const user = await createTestUser(ctx);
    const browser = new Browser(ctx);
    await browser.login(user.email, PASSWORD);
    const firstToken = browser.sessionToken;

    await browser.login(user.email, PASSWORD);
    expect(browser.sessionToken).not.toBe(firstToken);

    const stale = new Browser(ctx);
    stale.sessionToken = firstToken;
    expect((await stale.send("get", "/api/auth/session")).status).toBe(401);
  });

  it("rejects unknown fields (no mass assignment through login)", async () => {
    const user = await createTestUser(ctx);
    const res = await new Browser(ctx).send("post", "/api/auth/login", {
      email: user.email,
      password: PASSWORD,
      role: "admin",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("second factor at sign-in", () => {
  it("requires the code before anything else, then completes sign-in", async () => {
    const user = await createTestUser(ctx, { mfa: true });
    const browser = new Browser(ctx);
    const res = await browser.login(user.email, PASSWORD);
    expect(res.body).toEqual({ state: "mfa_pending" });
    const pendingToken = browser.sessionToken;

    const blocked = await browser.send("post", "/api/auth/sessions/revoke-others");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("mfa_required");

    const wrong = await browser.send("post", "/api/auth/mfa/verify", { code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("invalid_code");

    const ok = await browser.send("post", "/api/auth/mfa/verify", {
      code: codeFor(user.totpSecret ?? ""),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ state: "active" });
    // A new token is issued once the second factor is checked.
    expect(browser.sessionToken).not.toBe(pendingToken);
    // ...and the token from before the second factor no longer works (no session fixation).
    const stale = new Browser(ctx);
    stale.sessionToken = pendingToken;
    expect((await stale.send("get", "/api/auth/session")).status).toBe(401);
    expect((await browser.refresh()).body.state).toBe("active");
  });

  it("accepts each authenticator code only once (no replay)", async () => {
    const user = await createTestUser(ctx, { mfa: true });
    const code = codeFor(user.totpSecret ?? "");

    const first = new Browser(ctx);
    await first.login(user.email, PASSWORD);
    expect((await first.send("post", "/api/auth/mfa/verify", { code })).status).toBe(200);

    const second = new Browser(ctx);
    await second.login(user.email, PASSWORD);
    const replay = await second.send("post", "/api/auth/mfa/verify", { code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("invalid_code");
  });

  it("accepts a recovery code once", async () => {
    const admin = await createTestUser(ctx, { role: "admin" });
    const browser = new Browser(ctx);
    await browser.login(admin.email, PASSWORD);
    const setup = await browser.send("post", "/api/auth/mfa/totp/setup");
    const confirm = await browser.send("post", "/api/auth/mfa/totp/confirm", {
      code: codeFor(setup.body.secret as string),
    });
    const [recoveryCode] = confirm.body.recoveryCodes as string[];

    const later = new Browser(ctx);
    await later.login(admin.email, PASSWORD);
    expect((await later.send("post", "/api/auth/mfa/verify", { recoveryCode })).status).toBe(200);

    const again = new Browser(ctx);
    await again.login(admin.email, PASSWORD);
    expect((await again.send("post", "/api/auth/mfa/verify", { recoveryCode })).status).toBe(401);
  });

  it("makes an administrator without a second factor set one up first", async () => {
    const admin = await createTestUser(ctx, { role: "admin" });
    const browser = new Browser(ctx);
    expect((await browser.login(admin.email, PASSWORD)).body).toEqual({
      state: "mfa_setup_required",
    });

    const blocked = await browser.send("get", "/api/admin/users");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("mfa_setup_required");

    const setup = await browser.send("post", "/api/auth/mfa/totp/setup");
    expect(setup.status).toBe(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/Lexora:/);

    const wrong = await browser.send("post", "/api/auth/mfa/totp/confirm", { code: "123456" });
    expect(wrong.status).toBe(401);

    const confirm = await browser.send("post", "/api/auth/mfa/totp/confirm", {
      code: codeFor(setup.body.secret as string),
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    await browser.refresh();
    expect((await browser.send("get", "/api/admin/users")).status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("locks an account after 10 failed logins, even for the right password, and says when to retry", async () => {
    const user = await createTestUser(ctx);
    for (let i = 0; i < 10; i++) {
      const res = await new Browser(ctx).send("post", "/api/auth/login", {
        email: user.email,
        password: `wrong guess number ${i}`,
      });
      expect(res.status).toBe(401);
    }
    const locked = await new Browser(ctx).send("post", "/api/auth/login", {
      email: user.email,
      password: PASSWORD,
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("rate_limited");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);

    // Other accounts are unaffected.
    const other = await createTestUser(ctx);
    expect(
      (
        await new Browser(ctx).send("post", "/api/auth/login", {
          email: other.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
  });

  it("limits unknown e-mail addresses the same way (no enumeration through the limiter)", async () => {
    for (let i = 0; i < 10; i++) {
      await new Browser(ctx).send("post", "/api/auth/login", {
        email: "ghost@cabinet.test",
        password: `guess ${i}`,
      });
    }
    const res = await new Browser(ctx).send("post", "/api/auth/login", {
      email: "ghost@cabinet.test",
      password: "x",
    });
    expect(res.status).toBe(429);
  });

  it("stops second-factor guessing after 5 wrong codes", async () => {
    const user = await createTestUser(ctx, { mfa: true });
    const browser = new Browser(ctx);
    await browser.login(user.email, PASSWORD);
    for (let i = 0; i < 5; i++) {
      expect((await browser.send("post", "/api/auth/mfa/verify", { code: "000000" })).status).toBe(
        401,
      );
    }
    await browser.allowCodeReuse(user);
    const res = await browser.send("post", "/api/auth/mfa/verify", {
      code: codeFor(user.totpSecret ?? ""),
    });
    expect(res.status).toBe(429);
  });
});
