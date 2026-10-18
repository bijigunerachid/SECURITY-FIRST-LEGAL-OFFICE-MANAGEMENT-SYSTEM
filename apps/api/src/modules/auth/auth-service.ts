import type { PasswordProblemCode, Role } from "@lexora/shared";
import type { Config } from "../../config/env.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import type { Database } from "../../lib/database.js";
import { HttpError, conflict, notFound, rateLimited } from "../../http/errors.js";
import { recordAudit, type AuditEventInput } from "../audit/audit-log.js";
import { checkPassword, hashPassword, needsRehash, verifyPassword } from "./passwords.js";
import { RATE_RULES, RateLimiter, hashedKey } from "./rate-limit.js";
import {
  RECOVERY_CODE_COUNT,
  hashRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-codes.js";
import { SessionStore, stateFor, type ResolvedSession, type SessionState } from "./sessions.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  newTotpSecret,
  totpUri,
  verifyTotp,
} from "./totp.js";

/** Where a request came from, for rate limiting and the audit log. */
export interface RequestContext {
  requestId: string;
  ipAddress: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  state: SessionState;
}

/** How long a password setup or reset link stays valid. */
export const PASSWORD_TOKEN_LIFETIME_MS = 30 * 60_000;

const invalidCredentials = () => new HttpError(401, "invalid_credentials");
const invalidCode = () => new HttpError(401, "invalid_code");
const invalidToken = () => new HttpError(400, "invalid_token");
const passwordRejected = (reason: PasswordProblemCode) =>
  new HttpError(400, "password_rejected", undefined, reason);

export class AuthService {
  readonly sessions: SessionStore;
  readonly limiter: RateLimiter;

  constructor(
    private readonly db: Database,
    private readonly config: Pick<
      Config,
      | "argon2"
      | "mfaEncryptionKey"
      | "mfaEncryptionKeyPrevious"
      | "sessionIdleMs"
      | "sessionAbsoluteMs"
    >,
  ) {
    this.sessions = new SessionStore(db, {
      idleMs: config.sessionIdleMs,
      absoluteMs: config.sessionAbsoluteMs,
    });
    this.limiter = new RateLimiter(db);
  }

  audit(event: AuditEventInput, ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  private encryptionKeys(): Buffer[] {
    return [this.config.mfaEncryptionKey, this.config.mfaEncryptionKeyPrevious].filter(
      (key): key is Buffer => key !== null,
    );
  }

  // --- Sign-in ---------------------------------------------------------------

  /**
   * Checks e-mail and password. Every failure looks identical to the caller
   * (unknown account, wrong password, disabled account, password not yet
   * set) and takes about the same time, so accounts cannot be enumerated.
   */
  async login(email: string, password: string, ctx: RequestContext): Promise<IssuedSession> {
    const ipState = await this.limiter.hit(`login:ip:${ctx.ipAddress}`, RATE_RULES.loginPerIp);
    const accountKey = hashedKey("login:account", email);
    const accountState = await this.limiter.peek(accountKey, RATE_RULES.loginFailuresPerAccount);
    if (ipState.limited || accountState.limited) {
      await this.audit(
        { action: "auth.login", outcome: "denied", metadata: { reason: "rate_limited" } },
        ctx,
      );
      throw rateLimited(Math.max(ipState.retryAfterSeconds, accountState.retryAfterSeconds));
    }

    const user = await this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        passwordHash: true,
        disabledAt: true,
        totp: { select: { confirmedAt: true } },
      },
    });
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? null,
      password,
      this.config.argon2,
    );

    if (!user || !passwordOk || user.disabledAt !== null) {
      await this.limiter.hit(accountKey, RATE_RULES.loginFailuresPerAccount);
      await this.audit(
        {
          action: "auth.login",
          outcome: "failure",
          // Record which account only if it exists; never record the typed e-mail.
          actorUserId: user?.id ?? null,
          metadata: {
            reason: !user ? "unknown_account" : user.disabledAt ? "disabled" : "wrong_password",
          },
        },
        ctx,
      );
      throw invalidCredentials();
    }

    await this.limiter.reset(accountKey);
    if (user.passwordHash && needsRehash(user.passwordHash, this.config.argon2)) {
      await this.db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password, this.config.argon2) },
      });
    }

    const mfaEnabled = (user.totp?.confirmedAt ?? null) !== null;
    const state = stateFor(
      { id: user.id, email, displayName: "", role: user.role, mfaEnabled },
      null,
    );
    const issued = await this.sessions.create(user.id, {
      mfaVerified: false,
      fullyAuthenticated: state === "active",
    });
    await this.audit(
      { action: "auth.login", outcome: "success", actorUserId: user.id, metadata: { next: state } },
      ctx,
    );
    return { ...issued, state };
  }

  /** Second step of sign-in: a TOTP code or a single-use recovery code. */
  async verifyMfa(
    session: ResolvedSession,
    input: { code: string } | { recoveryCode: string },
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const userId = session.user.id;
    await this.assertMfaAttemptsAllowed(userId, ctx);

    const method = "code" in input ? "totp" : "recovery_code";
    const ok =
      "code" in input
        ? await this.checkTotp(userId, input.code)
        : await this.consumeRecoveryCode(userId, input.recoveryCode);

    if (!ok) {
      await this.limiter.hit(`mfa:user:${userId}`, RATE_RULES.mfaFailuresPerUser);
      await this.audit(
        {
          action: "auth.mfa.verify",
          outcome: "failure",
          actorUserId: userId,
          metadata: { method },
        },
        ctx,
      );
      throw invalidCode();
    }
    await this.limiter.reset(`mfa:user:${userId}`);
    const issued = await this.sessions.rotate(session.id, userId, {
      mfaVerified: true,
      fullyAuthenticated: true,
    });
    await this.audit(
      { action: "auth.mfa.verify", outcome: "success", actorUserId: userId, metadata: { method } },
      ctx,
    );
    return { ...issued, state: "active" };
  }

  private async assertMfaAttemptsAllowed(userId: string, ctx: RequestContext): Promise<void> {
    const state = await this.limiter.peek(`mfa:user:${userId}`, RATE_RULES.mfaFailuresPerUser);
    if (state.limited) {
      await this.audit(
        {
          action: "auth.mfa.verify",
          outcome: "denied",
          actorUserId: userId,
          metadata: { reason: "rate_limited" },
        },
        ctx,
      );
      throw rateLimited(state.retryAfterSeconds);
    }
  }

  /** Accepts a valid code once: a code from an earlier or the same time step is refused. */
  private async checkTotp(userId: string, code: string, requireConfirmed = true): Promise<boolean> {
    const factor = await this.db.totpFactor.findUnique({ where: { userId } });
    if (!factor || (requireConfirmed && factor.confirmedAt === null)) return false;
    const secret = decryptTotpSecret(
      { ciphertext: Buffer.from(factor.secretCiphertext), keyId: factor.keyId },
      userId,
      this.encryptionKeys(),
    );
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    // Atomic: only succeeds if no code from this or a later step was used before.
    const updated = await this.db.totpFactor.updateMany({
      where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return updated.count === 1;
  }

  private async consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
    if (normalizeRecoveryCode(input) === null) return false;
    const updated = await this.db.recoveryCode.updateMany({
      where: { userId, codeHash: new Uint8Array(hashRecoveryCode(input)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return updated.count === 1;
  }

  // --- Second factor enrolment -----------------------------------------------

  /** Starts (or restarts) TOTP enrolment. The secret is stored encrypted and unconfirmed. */
  async startTotpEnrolment(session: ResolvedSession): Promise<{ secret: string; uri: string }> {
    if (session.user.mfaEnabled) {
      throw conflict("A second factor is already set up");
    }
    const secret = newTotpSecret();
    const encrypted = encryptTotpSecret(secret, session.user.id, this.config.mfaEncryptionKey);
    const data = {
      secretCiphertext: new Uint8Array(encrypted.ciphertext),
      keyId: encrypted.keyId,
      confirmedAt: null,
      lastUsedStep: null,
    };
    await this.db.totpFactor.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    });
    return { secret, uri: totpUri(secret, session.user.email) };
  }

  /**
   * Confirms enrolment with a first code from the authenticator, creates
   * recovery codes (returned once, stored only as hashes) and upgrades the
   * session.
   */
  async confirmTotpEnrolment(
    session: ResolvedSession,
    code: string,
    ctx: RequestContext,
  ): Promise<{ issued: IssuedSession; recoveryCodes: string[] }> {
    const userId = session.user.id;
    if (session.user.mfaEnabled) {
      throw conflict("A second factor is already set up");
    }
    await this.assertMfaAttemptsAllowed(userId, ctx);
    if (!(await this.checkTotp(userId, code, false))) {
      await this.limiter.hit(`mfa:user:${userId}`, RATE_RULES.mfaFailuresPerUser);
      throw invalidCode();
    }
    const recoveryCodes = await this.db.$transaction(async (tx) => {
      await tx.totpFactor.update({ where: { userId }, data: { confirmedAt: new Date() } });
      return this.replaceRecoveryCodes(tx, userId);
    });
    // Signing out other sessions: they were created before the second factor existed.
    await this.sessions.revokeAllForUser(userId, session.id);
    const issued = await this.sessions.rotate(session.id, userId, {
      mfaVerified: true,
      fullyAuthenticated: true,
    });
    await this.audit({ action: "auth.mfa.enrol", outcome: "success", actorUserId: userId }, ctx);
    return { issued: { ...issued, state: "active" }, recoveryCodes };
  }

  async regenerateRecoveryCodes(session: ResolvedSession, ctx: RequestContext): Promise<string[]> {
    if (!session.user.mfaEnabled) {
      throw conflict("No second factor is set up");
    }
    const codes = await this.db.$transaction((tx) =>
      this.replaceRecoveryCodes(tx, session.user.id),
    );
    await this.audit(
      {
        action: "auth.mfa.recovery_codes.regenerate",
        outcome: "success",
        actorUserId: session.user.id,
      },
      ctx,
    );
    return codes;
  }

  private async replaceRecoveryCodes(
    tx: Parameters<Parameters<Database["$transaction"]>[0]>[0],
    userId: string,
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: new Uint8Array(hashRecoveryCode(code)) })),
    });
    return codes;
  }

  /** Turns off the user's own second factor. Administrators must keep theirs. */
  async disableOwnTotp(session: ResolvedSession, ctx: RequestContext): Promise<void> {
    if (session.user.role === "admin") {
      throw new HttpError(403, "forbidden", "Administrators must keep a second factor");
    }
    await this.removeSecondFactor(session.user.id);
    await this.audit(
      { action: "auth.mfa.disable", outcome: "success", actorUserId: session.user.id },
      ctx,
    );
  }

  private async removeSecondFactor(userId: string): Promise<void> {
    await this.db.$transaction([
      this.db.totpFactor.deleteMany({ where: { userId } }),
      this.db.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  // --- Re-authentication and passwords ---------------------------------------

  /** Confirms identity again before a sensitive action. */
  async reauthenticate(
    session: ResolvedSession,
    input: { password: string; code?: string | undefined },
    ctx: RequestContext,
  ): Promise<void> {
    const userId = session.user.id;
    const key = `reauth:user:${userId}`;
    const state = await this.limiter.peek(key, RATE_RULES.reauthFailuresPerUser);
    if (state.limited) {
      throw rateLimited(state.retryAfterSeconds);
    }
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    let ok = await verifyPassword(user.passwordHash, input.password, this.config.argon2);
    if (ok && session.user.mfaEnabled) {
      ok = input.code !== undefined && (await this.checkTotp(userId, input.code));
    }
    if (!ok) {
      await this.limiter.hit(key, RATE_RULES.reauthFailuresPerUser);
      await this.audit({ action: "auth.reauth", outcome: "failure", actorUserId: userId }, ctx);
      throw session.user.mfaEnabled && input.code === undefined
        ? new HttpError(400, "invalid_code")
        : invalidCredentials();
    }
    await this.limiter.reset(key);
    await this.sessions.markReauthenticated(session.id);
    await this.audit({ action: "auth.reauth", outcome: "success", actorUserId: userId }, ctx);
  }

  async changePassword(
    session: ResolvedSession,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const userId = session.user.id;
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, email: true, displayName: true },
    });
    if (!(await verifyPassword(user.passwordHash, currentPassword, this.config.argon2))) {
      await this.limiter.hit(`reauth:user:${userId}`, RATE_RULES.reauthFailuresPerUser);
      await this.audit(
        { action: "auth.password.change", outcome: "failure", actorUserId: userId },
        ctx,
      );
      throw invalidCredentials();
    }
    await this.setPassword(userId, newPassword, user);
    // Everyone else signed in as this user is signed out; this session gets a fresh token.
    await this.sessions.revokeAllForUser(userId, session.id);
    const issued = await this.sessions.rotate(session.id, userId, {
      mfaVerified: session.user.mfaEnabled,
      fullyAuthenticated: true,
    });
    await this.audit(
      { action: "auth.password.change", outcome: "success", actorUserId: userId },
      ctx,
    );
    return { ...issued, state: "active" };
  }

  private async setPassword(
    userId: string,
    password: string,
    context: { email: string; displayName: string },
  ): Promise<void> {
    const problem = checkPassword(password, context);
    if (problem) {
      throw passwordRejected(problem);
    }
    await this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password, this.config.argon2),
        passwordChangedAt: new Date(),
      },
    });
  }

  /**
   * Sets a password with a setup/reset token. The token is single-use and
   * short-lived; using it signs the user out everywhere.
   */
  async setPasswordWithToken(token: string, password: string, ctx: RequestContext): Promise<void> {
    const ipState = await this.limiter.hit(
      `pwset:ip:${ctx.ipAddress}`,
      RATE_RULES.passwordSetPerIp,
    );
    if (ipState.limited) {
      throw rateLimited(ipState.retryAfterSeconds);
    }
    const record = await this.db.passwordToken.findUnique({
      where: { tokenHash: new Uint8Array(sha256(token)) },
      include: { user: { select: { id: true, email: true, displayName: true, disabledAt: true } } },
    });
    const usable =
      record !== null &&
      record.usedAt === null &&
      record.expiresAt > new Date() &&
      record.user.disabledAt === null;
    if (!usable) {
      await this.audit(
        { action: "auth.password.set", outcome: "failure", actorUserId: record?.userId ?? null },
        ctx,
      );
      throw invalidToken();
    }
    // Check the policy before consuming the token, so a rejected password can be retried.
    const problem = checkPassword(password, record.user);
    if (problem) {
      throw passwordRejected(problem);
    }
    const claimed = await this.db.passwordToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw invalidToken();
    }
    await this.setPassword(record.userId, password, record.user);
    await this.sessions.revokeAllForUser(record.userId);
    await this.audit(
      { action: "auth.password.set", outcome: "success", actorUserId: record.userId },
      ctx,
    );
  }

  // --- User administration ---------------------------------------------------

  /** Issues a new single-use password link and invalidates older unused ones. */
  async issuePasswordToken(
    userId: string,
    issuedById: string | null,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + PASSWORD_TOKEN_LIFETIME_MS);
    await this.db.$transaction([
      this.db.passwordToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.passwordToken.create({
        data: { tokenHash: new Uint8Array(sha256(token)), userId, issuedById, expiresAt },
      }),
    ]);
    return { token, expiresAt };
  }

  async createUser(
    input: { email: string; displayName: string; role: Role },
    actorId: string | null,
    ctx: RequestContext,
  ) {
    const existing = await this.db.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw conflict("A user with this e-mail address already exists");
    }
    let user;
    try {
      user = await this.db.user.create({ data: input });
    } catch (error) {
      // Two requests raced past the check above; the unique index decided.
      if ((error as { code?: unknown }).code === "P2002") {
        throw conflict("A user with this e-mail address already exists");
      }
      throw error;
    }
    const setup = await this.issuePasswordToken(user.id, actorId);
    await this.audit(
      {
        action: "admin.user.create",
        outcome: "success",
        actorUserId: actorId,
        targetType: "user",
        targetId: user.id,
        metadata: { role: input.role },
      },
      ctx,
    );
    return { userId: user.id, setup };
  }

  async updateUser(
    actor: ResolvedSession,
    targetId: string,
    changes: {
      displayName?: string | undefined;
      role?: Role | undefined;
      disabled?: boolean | undefined;
    },
    ctx: RequestContext,
  ): Promise<void> {
    const { target, roleChanges, disabling } = await this.db.$transaction(async (tx) => {
      // Lock every active administrator row first. Two administrators
      // demoting each other at the same moment are then handled one after
      // the other, so the office can never end up with no administrator.
      const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM app_user WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`;
      const adminIds = new Set(activeAdmins.map((row) => row.id));
      // The actor may have been demoted or disabled since this request was authorised.
      if (!adminIds.has(actor.user.id)) {
        throw notFound();
      }

      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) throw notFound();

      const roleChanges = changes.role !== undefined && changes.role !== target.role;
      const disabling = changes.disabled === true && target.disabledAt === null;
      if (targetId === actor.user.id && (roleChanges || changes.disabled === true)) {
        throw conflict("You cannot change your own role or disable your own account");
      }
      const removesAdmin = adminIds.has(targetId) && (disabling || roleChanges);
      if (removesAdmin && adminIds.size <= 1) {
        throw conflict("The last active administrator cannot be demoted or disabled");
      }

      await tx.user.update({
        where: { id: targetId },
        data: {
          ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
          ...(changes.role === undefined ? {} : { role: changes.role }),
          ...(changes.disabled === undefined
            ? {}
            : { disabledAt: changes.disabled ? (target.disabledAt ?? new Date()) : null }),
        },
      });
      return { target, roleChanges, disabling };
    });
    // A changed role or a disabled account must take effect immediately.
    if (roleChanges || disabling) {
      await this.sessions.revokeAllForUser(targetId);
    }
    await this.audit(
      {
        action: "admin.user.update",
        outcome: "success",
        actorUserId: actor.user.id,
        targetType: "user",
        targetId,
        metadata: {
          ...(roleChanges ? { role: { from: target.role, to: changes.role } } : {}),
          ...(changes.disabled === undefined ? {} : { disabled: changes.disabled }),
          ...(changes.displayName === undefined ? {} : { displayNameChanged: true }),
        },
      },
      ctx,
    );
  }

  async adminIssuePasswordToken(actor: ResolvedSession, targetId: string, ctx: RequestContext) {
    const target = await this.db.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw notFound();
    const issued = await this.issuePasswordToken(targetId, actor.user.id);
    await this.audit(
      {
        action: "admin.user.password_token",
        outcome: "success",
        actorUserId: actor.user.id,
        targetType: "user",
        targetId,
      },
      ctx,
    );
    return issued;
  }

  async adminResetSecondFactor(
    actor: ResolvedSession,
    targetId: string,
    ctx: RequestContext,
  ): Promise<void> {
    if (targetId === actor.user.id) {
      throw conflict("Manage your own second factor from your security settings");
    }
    const target = await this.db.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw notFound();
    await this.removeSecondFactor(targetId);
    await this.sessions.revokeAllForUser(targetId);
    await this.audit(
      {
        action: "admin.user.mfa_reset",
        outcome: "success",
        actorUserId: actor.user.id,
        targetType: "user",
        targetId,
      },
      ctx,
    );
  }

  async adminRevokeSessions(
    actor: ResolvedSession,
    targetId: string,
    ctx: RequestContext,
  ): Promise<number> {
    const target = await this.db.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw notFound();
    const revoked = await this.sessions.revokeAllForUser(
      targetId,
      targetId === actor.user.id ? actor.id : undefined,
    );
    await this.audit(
      {
        action: "admin.user.sessions_revoke",
        outcome: "success",
        actorUserId: actor.user.id,
        targetType: "user",
        targetId,
        metadata: { revoked },
      },
      ctx,
    );
    return revoked;
  }

  async listUsers() {
    const users = await this.db.user.findMany({
      orderBy: [{ disabledAt: { sort: "asc", nulls: "first" } }, { displayName: "asc" }],
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        disabledAt: true,
        passwordHash: true,
        createdAt: true,
        totp: { select: { confirmedAt: true } },
        sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      disabled: user.disabledAt !== null,
      mfaEnabled: (user.totp?.confirmedAt ?? null) !== null,
      hasPassword: user.passwordHash !== null,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.sessions[0]?.lastSeenAt.toISOString() ?? null,
    }));
  }
}
