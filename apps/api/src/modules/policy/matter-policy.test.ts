import { describe, expect, it } from "vitest";
import {
  MATTER_ACTIONS,
  billingMattersWhere,
  canOnMatter,
  clientPermissions,
  matterAccess,
  visibleClientsWhere,
  visibleMattersWhere,
  type Actor,
  type MatterAction,
} from "./matter-policy.js";

const lawyer: Actor = { id: "lawyer", role: "lawyer" };
const assistant: Actor = { id: "assistant", role: "assistant" };
const admin: Actor = { id: "admin", role: "admin" };
const later = new Date(Date.now() + 60_000);

type Case = [
  name: string,
  actor: Actor,
  membership: "lead" | "member" | null,
  grant: Date | null,
  leadCanAct: boolean,
  allowed: MatterAction[],
];

/**
 * The full matrix: every kind of actor × every action. Anything not listed
 * as allowed must be refused.
 */
const cases: Case[] = [
  [
    "lead lawyer",
    lawyer,
    "lead",
    null,
    true,
    [
      "read",
      "update",
      "manageTeam",
      "setRestricted",
      "readHistory",
      "writeParties",
      "updateClient",
      "writeDocuments",
      "writeCalendar",
      "deleteDocuments",
      "deleteTasks",
      "readBilling",
      "draftInvoices",
      "manageBilling",
    ],
  ],
  [
    "member lawyer",
    lawyer,
    "member",
    null,
    true,
    [
      "read",
      "update",
      "writeParties",
      "updateClient",
      "writeDocuments",
      "writeCalendar",
      "deleteDocuments",
      "deleteTasks",
      "readBilling",
      "draftInvoices",
      "manageBilling",
    ],
  ],
  [
    "member lawyer when the lead can no longer act",
    lawyer,
    "member",
    null,
    false,
    [
      "read",
      "update",
      "writeParties",
      "updateClient",
      "claimLead",
      "writeDocuments",
      "writeCalendar",
      "deleteDocuments",
      "deleteTasks",
      "readBilling",
      "draftInvoices",
      "manageBilling",
    ],
  ],
  [
    "member assistant",
    assistant,
    "member",
    null,
    true,
    [
      "read",
      "writeParties",
      "updateClient",
      "writeDocuments",
      "writeCalendar",
      "readBilling",
      "draftInvoices",
    ],
  ],
  [
    "assistant still marked lead after a role change",
    assistant,
    "lead",
    null,
    false,
    [
      "read",
      "writeParties",
      "updateClient",
      "writeDocuments",
      "writeCalendar",
      "readBilling",
      "draftInvoices",
    ],
  ],
  [
    "assistant when the lead can no longer act",
    assistant,
    "member",
    null,
    false,
    [
      "read",
      "writeParties",
      "updateClient",
      "writeDocuments",
      "writeCalendar",
      "readBilling",
      "draftInvoices",
    ],
  ],
  ["lawyer outside the team", lawyer, null, null, true, []],
  ["assistant outside the team", assistant, null, null, true, []],
  ["administrator", admin, null, null, true, []],
  ["administrator who used to be a member", admin, "lead", null, false, []],
  ["administrator with break-glass access", admin, null, later, true, ["read"]],
  // A lawyer cannot obtain access through a grant row (grants are for administrators).
  ["lawyer with a stray grant", lawyer, null, later, true, []],
];

describe("matter policy matrix", () => {
  for (const [name, actor, membership, grant, leadCanAct, allowed] of cases) {
    it(`${name}: may ${allowed.length ? allowed.join(", ") : "do nothing"}`, () => {
      const access = matterAccess(actor, membership, grant);
      for (const action of MATTER_ACTIONS) {
        expect(canOnMatter(actor, access, action, { leadCanAct }), action).toBe(
          allowed.includes(action),
        );
      }
    });
  }
});

describe("query scoping", () => {
  const now = new Date("2026-10-21T10:00:00Z");

  it("limits members to matters they belong to", () => {
    expect(visibleMattersWhere(lawyer, now)).toEqual({
      members: { some: { userId: "lawyer" } },
    });
  });

  it("limits administrators to unexpired, unended grants of their own", () => {
    expect(visibleMattersWhere(admin, now)).toEqual({
      breakGlassGrants: { some: { userId: "admin", expiresAt: { gt: now }, endedAt: null } },
    });
  });

  it("limits billing to the team, and never extends it to administrators", () => {
    expect(billingMattersWhere(assistant)).toEqual({
      members: { some: { userId: "assistant" } },
    });
    expect(billingMattersWhere(admin)).toEqual({ id: { in: [] } });
  });

  it("shows clients through visible matters, and own clients that have no matter yet", () => {
    expect(visibleClientsWhere(assistant, now)).toEqual({
      OR: [
        { matters: { some: { members: { some: { userId: "assistant" } } } } },
        { createdById: "assistant", matters: { none: {} } },
      ],
    });
    // Administrators never see unattached clients.
    expect(visibleClientsWhere(admin, now)).not.toHaveProperty("OR");
  });
});

describe("client permissions", () => {
  it("lets the lawyer who recorded a client without matters edit it and open a matter", () => {
    expect(clientPermissions(lawyer, [], true)).toEqual({ update: true, openMatter: true });
  });

  it("follows the rights on the client's matters", () => {
    expect(clientPermissions(assistant, [{ updateClient: true }], false)).toEqual({
      update: true,
      openMatter: false,
    });
    expect(clientPermissions(admin, [{ updateClient: false }], false)).toEqual({
      update: false,
      openMatter: false,
    });
  });
});
