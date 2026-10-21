import { expect } from "vitest";
import { Browser, createTestUser, type IntegrationContext, type TestUser } from "./integration.js";

/** Helpers for client and matter integration tests. Everything goes through the real API. */

export interface Person {
  user: TestUser;
  browser: Browser;
}

/** A signed-in user of the given role (administrators always have a second factor). */
export async function person(
  ctx: IntegrationContext,
  role: "admin" | "lawyer" | "assistant",
  options: { reauth?: boolean; mfa?: boolean } = {},
): Promise<Person> {
  const user = await createTestUser(ctx, { role, mfa: role === "admin" || options.mfa === true });
  const browser = new Browser(ctx);
  await browser.signIn(user);
  if (options.reauth) expect((await browser.reauth(user)).status).toBe(204);
  return { user, browser };
}

export async function createClient(
  lawyer: Person,
  body: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const res = await lawyer.browser.send("post", "/api/clients", {
    kind: "person",
    name: "Salma Berrada",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const client = (res.body as { client: { id: string; name: string } }).client;
  return { id: client.id, name: client.name };
}

export async function createMatter(
  lawyer: Person,
  clientId: string,
  body: Record<string, unknown> = {},
): Promise<{ id: string; reference: string }> {
  const res = await lawyer.browser.send("post", "/api/matters", {
    clientId,
    title: "Succession Berrada",
    area: "family",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const matter = (res.body as { matter: { id: string; reference: string } }).matter;
  return { id: matter.id, reference: matter.reference };
}

export async function addMember(lead: Person, matterId: string, member: Person): Promise<void> {
  const res = await lead.browser.send("post", `/api/matters/${matterId}/members`, {
    userId: member.user.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
}

export async function addParty(
  member: Person,
  matterId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await member.browser.send("post", `/api/matters/${matterId}/parties`, {
    kind: "company",
    name: "Atlas Immobilier SARL",
    role: "opposing_party",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** Audit actions recorded so far, oldest first. */
export async function auditActions(
  ctx: IntegrationContext,
): Promise<{ action: string; outcome: string; targetId: string | null; metadata: unknown }[]> {
  const { rows } = await ctx.owner.query<{
    action: string;
    outcome: string;
    target_id: string | null;
    metadata: unknown;
  }>("SELECT action, outcome, target_id, metadata FROM audit_event ORDER BY id");
  return rows.map((r) => ({
    action: r.action,
    outcome: r.outcome,
    targetId: r.target_id,
    metadata: r.metadata,
  }));
}
