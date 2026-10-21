import { sha256 } from "../../lib/crypto.js";
import type { Database } from "../../lib/database.js";

/**
 * Fixed-window rate limiting stored in PostgreSQL, so limits hold across
 * restarts and processes (ADR 0005). Each operation is one atomic SQL
 * statement, so concurrent requests cannot slip past a limit.
 */

export interface RateRule {
  /** Maximum events in the window. */
  limit: number;
  windowSeconds: number;
}

export interface RateState {
  count: number;
  resetAt: Date;
  limited: boolean;
  retryAfterSeconds: number;
}

/** Keys must never contain personal data: hash identifiers such as e-mail addresses. */
export function hashedKey(prefix: string, value: string): string {
  return `${prefix}:${sha256(value.toLowerCase()).subarray(0, 16).toString("hex")}`;
}

function toState(row: { count: number; reset_at: Date } | undefined, rule: RateRule): RateState {
  const count = row?.count ?? 0;
  const resetAt = row?.reset_at ?? new Date();
  return {
    count,
    resetAt,
    limited: count > rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
  };
}

export class RateLimiter {
  constructor(private readonly db: Database) {}

  /** Records one event and reports whether the limit is now exceeded. */
  async hit(key: string, rule: RateRule): Promise<RateState> {
    const rows = await this.db.$queryRaw<{ count: number; reset_at: Date }[]>`
      INSERT INTO rate_limit_bucket (key, count, reset_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_bucket.reset_at <= now() THEN 1
                     ELSE rate_limit_bucket.count + 1 END,
        reset_at = CASE WHEN rate_limit_bucket.reset_at <= now() THEN EXCLUDED.reset_at
                        ELSE rate_limit_bucket.reset_at END
      RETURNING count, reset_at`;
    if (Math.random() < 0.01) {
      await this.purgeExpired();
    }
    return toState(rows[0], rule);
  }

  /** Reports the current state without recording an event. */
  async peek(key: string, rule: RateRule): Promise<RateState> {
    const rows = await this.db.$queryRaw<{ count: number; reset_at: Date }[]>`
      SELECT count, reset_at FROM rate_limit_bucket WHERE key = ${key} AND reset_at > now()`;
    const state = toState(rows[0], rule);
    // At the limit already means the next attempt would exceed it.
    return { ...state, limited: state.count >= rule.limit };
  }

  async reset(key: string): Promise<void> {
    await this.db.$executeRaw`DELETE FROM rate_limit_bucket WHERE key = ${key}`;
  }

  async purgeExpired(): Promise<void> {
    await this.db.$executeRaw`DELETE FROM rate_limit_bucket WHERE reset_at <= now()`;
  }
}

/** Limits used by the authentication routes and conflict searches. */
export const RATE_RULES = {
  /**
   * Conflict searches by one user. They reveal names across the office
   * (minimum fields only), so mass harvesting is slowed and audited.
   */
  conflictSearchesPerUser: { limit: 60, windowSeconds: 15 * 60 },
  /** Document uploads (new documents and versions) by one user. */
  uploadsPerUser: { limit: 120, windowSeconds: 15 * 60 },
  /** All login attempts from one IP address. */
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  /** Failed logins for one account (keyed by hashed e-mail, existing or not). */
  loginFailuresPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  /** Wrong second-factor codes for one user. */
  mfaFailuresPerUser: { limit: 5, windowSeconds: 15 * 60 },
  /** Wrong passwords when confirming identity for a sensitive action. */
  reauthFailuresPerUser: { limit: 5, windowSeconds: 15 * 60 },
  /** Attempts to use a password setup or reset token from one IP address. */
  passwordSetPerIp: { limit: 20, windowSeconds: 15 * 60 },
} satisfies Record<string, RateRule>;
