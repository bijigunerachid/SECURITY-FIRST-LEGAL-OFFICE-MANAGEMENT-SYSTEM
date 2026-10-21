import { randomToken, sha256 } from "../../lib/crypto.js";
import type { Database } from "../../lib/database.js";
import type { Role } from "../../generated/prisma/client.js";

/**
 * Opaque server-side sessions (ADR 0002).
 *
 * The browser holds a random 256-bit token in an HttpOnly cookie; the
 * database holds only its SHA-256, so a copy of the database contains no
 * usable sessions. Sessions expire after an idle period and an absolute
 * lifetime, are replaced (rotated) at every privilege change, and can be
 * revoked server-side at any time.
 */

export const SESSION_COOKIE = "__Host-lexora_session";
/** A session waiting for the second factor lives only briefly. */
export const PENDING_MFA_LIFETIME_MS = 10 * 60_000;
/** A recent re-entry of the password unlocks sensitive actions for this long. */
export const REAUTH_VALIDITY_MS = 5 * 60_000;
/** Avoid a database write on every request: refresh last-seen at most once a minute. */
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionSettings {
  idleMs: number;
  absoluteMs: number;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  mfaEnabled: boolean;
}

/**
 * - `active`: fully signed in.
 * - `mfa_pending`: password correct, second factor not yet checked.
 * - `mfa_setup_required`: an administrator without a second factor must set one up first.
 */
export type SessionState = "active" | "mfa_pending" | "mfa_setup_required";

export interface ResolvedSession {
  id: string;
  user: SessionUser;
  state: SessionState;
  csrfToken: string;
  reauthenticatedAt: Date | null;
  expiresAt: Date;
}

export function stateFor(user: SessionUser, mfaVerifiedAt: Date | null): SessionState {
  if (user.mfaEnabled) {
    return mfaVerifiedAt ? "active" : "mfa_pending";
  }
  return user.role === "admin" ? "mfa_setup_required" : "active";
}

export class SessionStore {
  constructor(
    private readonly db: Database,
    private readonly settings: SessionSettings,
  ) {}

  /**
   * Creates a session and returns the token for the cookie. A session that
   * still needs its second factor gets a short lifetime until upgraded.
   */
  async create(
    userId: string,
    options: { mfaVerified: boolean; fullyAuthenticated: boolean },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        (options.fullyAuthenticated ? this.settings.absoluteMs : PENDING_MFA_LIFETIME_MS),
    );
    await this.db.session.create({
      data: {
        tokenHash: new Uint8Array(sha256(token)),
        userId,
        lastSeenAt: now,
        expiresAt,
        mfaVerifiedAt: options.mfaVerified ? now : null,
        csrfToken: randomToken(32),
      },
    });
    return { token, expiresAt };
  }

  /**
   * Looks up the session for a cookie token. Expired, idle or disabled-user
   * sessions are deleted and treated as absent.
   */
  async resolve(token: string, now = new Date()): Promise<ResolvedSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = new Uint8Array(sha256(token));
    const session = await this.db.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            disabledAt: true,
            totp: { select: { confirmedAt: true } },
          },
        },
      },
    });
    if (!session) return null;

    const idleExpired = now.getTime() - session.lastSeenAt.getTime() > this.settings.idleMs;
    if (session.expiresAt <= now || idleExpired || session.user.disabledAt !== null) {
      await this.db.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    const user: SessionUser = {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
      mfaEnabled: (session.user.totp?.confirmedAt ?? null) !== null,
    };
    return {
      id: session.id,
      user,
      state: stateFor(user, session.mfaVerifiedAt),
      csrfToken: session.csrfToken,
      reauthenticatedAt: session.reauthenticatedAt,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Replaces a session with a new one (new token, new CSRF token), carrying
   * over its MFA state. Used after any privilege change, so a token observed
   * before the change is useless afterwards (prevents session fixation).
   */
  async rotate(
    sessionId: string,
    userId: string,
    options: { mfaVerified: boolean; fullyAuthenticated: boolean },
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
    return this.create(userId, options);
  }

  async markReauthenticated(sessionId: string): Promise<void> {
    await this.db.session.update({
      where: { id: sessionId },
      data: { reauthenticatedAt: new Date() },
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }

  /** Signs the user out everywhere, optionally keeping one session. Returns how many were revoked. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.db.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    });
    return result.count;
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const idleCutoff = new Date(now.getTime() - this.settings.idleMs);
    const result = await this.db.session.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { lastSeenAt: { lt: idleCutoff } }] },
    });
    return result.count;
  }
}

export function isRecentlyReauthenticated(session: ResolvedSession, now = Date.now()): boolean {
  return (
    session.reauthenticatedAt !== null &&
    now - session.reauthenticatedAt.getTime() <= REAUTH_VALIDITY_MS
  );
}
