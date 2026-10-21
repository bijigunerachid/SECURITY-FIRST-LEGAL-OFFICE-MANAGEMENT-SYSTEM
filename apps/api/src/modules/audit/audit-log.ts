import { sha256 } from "../../lib/crypto.js";
import type { Database } from "../../lib/database.js";

/**
 * Tamper-evident audit log.
 *
 * Each event stores `prev_hash` (the previous event's hash) and
 * `hash = SHA-256(prev_hash ‖ canonical content)`. Editing or deleting any
 * row breaks every later hash, which `verifyAuditChain` detects. The
 * application role can only INSERT and SELECT this table, and a trigger
 * refuses UPDATE and DELETE (see the migration).
 *
 * This is tamper-evident, not tamper-proof: someone with owner or root access
 * could rewrite the whole chain. Copying the latest hash off the server (with
 * each backup) makes that detectable too.
 *
 * Never put passwords, tokens, codes or document contents in an event.
 */

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEventInput {
  action: string;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

const GENESIS = Buffer.alloc(32);
/** Serialises writers so each event links to the true previous one. */
const AUDIT_LOCK_KEY = 0x4c58_4155; // "LXAU"

/** JSON with object keys sorted at every level, so PostgreSQL's jsonb key reordering cannot change the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface HashedFields {
  occurredAt: Date;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  ipAddress: string | null;
  metadata: unknown;
}

function eventHash(prevHash: Buffer, fields: HashedFields): Buffer {
  const content = canonicalJson([
    fields.occurredAt.toISOString(),
    fields.actorUserId,
    fields.action,
    fields.targetType,
    fields.targetId,
    fields.outcome,
    fields.requestId,
    fields.ipAddress,
    fields.metadata ?? null,
  ]);
  return sha256(Buffer.concat([prevHash, Buffer.from(content, "utf8")]));
}

export async function recordAudit(db: Database, input: AuditEventInput): Promise<void> {
  const fields: HashedFields = {
    occurredAt: new Date(),
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    outcome: input.outcome,
    requestId: input.requestId ?? null,
    ipAddress: input.ipAddress ?? null,
    metadata: input.metadata ?? null,
  };

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
    const last = await tx.auditEvent.findFirst({
      orderBy: { id: "desc" },
      select: { hash: true },
    });
    const prevHash = last ? Buffer.from(last.hash) : GENESIS;
    await tx.auditEvent.create({
      data: {
        ...fields,
        metadata: (fields.metadata ?? undefined) as never,
        prevHash: new Uint8Array(prevHash),
        hash: new Uint8Array(eventHash(prevHash, fields)),
      },
    });
  });
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  /** ID of the first event whose hash or link does not match. */
  firstInvalidId: bigint | null;
  latestHash: string | null;
}

/** Recomputes every hash in order. Reads in pages to bound memory. */
export async function verifyAuditChain(db: Database, pageSize = 1000): Promise<ChainVerification> {
  let prevHash = GENESIS;
  let checked = 0;
  let cursor: bigint | undefined;

  for (;;) {
    const page = await db.auditEvent.findMany({
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    for (const event of page) {
      const stored = Buffer.from(event.hash);
      const expected = eventHash(prevHash, {
        occurredAt: event.occurredAt,
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        outcome: event.outcome,
        requestId: event.requestId,
        ipAddress: event.ipAddress,
        metadata: event.metadata,
      });
      if (!Buffer.from(event.prevHash).equals(prevHash) || !stored.equals(expected)) {
        return { valid: false, checked, firstInvalidId: event.id, latestHash: null };
      }
      prevHash = stored;
      checked += 1;
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1]?.id;
  }
  return {
    valid: true,
    checked,
    firstInvalidId: null,
    latestHash: checked === 0 ? null : prevHash.toString("hex"),
  };
}
