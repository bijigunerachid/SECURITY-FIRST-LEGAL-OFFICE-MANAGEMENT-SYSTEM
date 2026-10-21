import type { ConflictHit } from "@lexora/shared";
import { HttpError, rateLimited } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import { RATE_RULES, type RateLimiter } from "../auth/rate-limit.js";
import type { Actor } from "../policy/matter-policy.js";
import { identifierKey, searchKey } from "./search-text.js";

/** At most this many hits are returned; more means "refine the search". */
export const CONFLICT_HIT_LIMIT = 50;
/** Shortest normalised search text, so one letter cannot list the whole office. */
const MIN_KEY_LENGTH = 3;

interface MatterRow {
  id: string;
  reference: string;
  status: "open" | "on_hold" | "closed";
  restricted: boolean;
  members: { userId: string; role: "lead" | "member"; user: { displayName: string } }[];
}

const matterSelect = (actor: Actor) => ({
  id: true,
  reference: true,
  status: true,
  restricted: true,
  members: {
    where: { OR: [{ role: "lead" as const }, { userId: actor.id }] },
    select: { userId: true, role: true, user: { select: { displayName: true } } },
  },
});

/**
 * What a hit may reveal depends on the actor's relation to the matter:
 *
 * - member: everything needed to open it;
 * - not a member: the reference, status and lead lawyer, to ask them;
 * - not a member of a restricted matter: only that a confidential matter
 *   matches, and whom to ask. Not the stored name, reference or status.
 */
function hitFor(
  actor: Actor,
  name: string,
  matchedAs: ConflictHit["matchedAs"],
  matter: MatterRow,
): ConflictHit {
  const member = matter.members.some((m) => m.userId === actor.id);
  const lead = matter.members.find((m) => m.role === "lead")?.user.displayName ?? null;
  const hidden = matter.restricted && !member;
  return {
    matchedName: hidden ? null : name,
    matchedAs,
    matter: {
      id: member ? matter.id : null,
      reference: hidden ? null : matter.reference,
      status: hidden ? null : matter.status,
      restricted: matter.restricted,
    },
    contact: lead,
  };
}

/**
 * Conflict-of-interest search across every client and party in the office,
 * including matters the lawyer does not belong to (that is its purpose),
 * returning only the minimum fields above. Lawyers only; rate limited; every
 * search is audited (without the searched text, which is personal data).
 */
export async function searchConflicts(
  db: Database,
  limiter: RateLimiter,
  actor: Actor,
  q: string,
  ctx: RequestContext,
): Promise<{ hits: ConflictHit[]; truncated: boolean }> {
  const key = searchKey(q);
  const idKey = identifierKey(q);
  if (key.length < MIN_KEY_LENGTH && idKey.length < MIN_KEY_LENGTH) {
    throw new HttpError(400, "validation_failed");
  }
  const rate = await limiter.hit(`conflicts:user:${actor.id}`, RATE_RULES.conflictSearchesPerUser);
  if (rate.limited) {
    await recordAudit(db, {
      action: "conflict.search",
      outcome: "denied",
      actorUserId: actor.id,
      metadata: { reason: "rate_limited" },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    throw rateLimited(rate.retryAfterSeconds);
  }

  const nameOrId = <T>(name: T, id: T) => [
    ...(key.length >= MIN_KEY_LENGTH ? [name] : []),
    ...(idKey.length >= MIN_KEY_LENGTH ? [id] : []),
  ];
  const take = CONFLICT_HIT_LIMIT + 1;
  const [clients, parties] = await Promise.all([
    db.client.findMany({
      where: {
        OR: nameOrId({ searchName: { contains: key } }, { searchIdentifier: { contains: idKey } }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: {
        name: true,
        createdBy: { select: { displayName: true } },
        matters: {
          orderBy: [{ openedOn: "desc" }, { id: "asc" }],
          take,
          select: matterSelect(actor),
        },
      },
    }),
    db.party.findMany({
      where: {
        OR: nameOrId({ searchName: { contains: key } }, { searchIdentifier: { contains: idKey } }),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: { name: true, role: true, matter: { select: matterSelect(actor) } },
    }),
  ]);

  const hits: ConflictHit[] = [];
  for (const client of clients) {
    if (client.matters.length === 0) {
      // Recorded but no matter yet: whoever recorded the client can say more.
      hits.push({
        matchedName: client.name,
        matchedAs: "client",
        matter: null,
        contact: client.createdBy.displayName,
      });
    }
    for (const matter of client.matters) hits.push(hitFor(actor, client.name, "client", matter));
  }
  for (const party of parties) hits.push(hitFor(actor, party.name, party.role, party.matter));

  const truncated = hits.length > CONFLICT_HIT_LIMIT;
  const returned = hits.slice(0, CONFLICT_HIT_LIMIT);
  await recordAudit(db, {
    action: "conflict.search",
    outcome: "success",
    actorUserId: actor.id,
    metadata: { hits: returned.length, truncated },
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
  });
  return { hits: returned, truncated };
}
