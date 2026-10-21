import { conflictResponseSchema, type ConflictHit } from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addParty,
  auditActions,
  createClient,
  createMatter,
  person,
  type Person,
} from "../../test/matters.js";

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

async function search(who: Person | Browser, q: string) {
  const browser = who instanceof Browser ? who : who.browser;
  return browser.send("get", `/api/conflicts?q=${encodeURIComponent(q)}`);
}

async function hits(who: Person, q: string): Promise<ConflictHit[]> {
  const res = await search(who, q);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return conflictResponseSchema.parse(res.body).hits;
}

describe("conflict search", () => {
  it("finds clients and parties across the office, revealing only the minimum to non-members", async () => {
    const me = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const mine = await createClient(me, { name: "Omar Benjelloun" });
    const myMatter = await createMatter(me, mine.id);

    const theirs = await createClient(colleague, { name: "Société Benjelloun Frères" });
    const theirMatter = await createMatter(colleague, theirs.id, {
      title: "Ne doit pas apparaître",
    });
    await addParty(colleague, theirMatter.id, { name: "Leila Benjelloun", role: "opposing_party" });

    const found = await hits(me, "benjelloun");
    expect(found).toHaveLength(3);
    expect(found).toEqual(
      expect.arrayContaining([
        {
          matchedName: "Omar Benjelloun",
          matchedAs: "client",
          matter: {
            id: myMatter.id,
            reference: myMatter.reference,
            status: "open",
            restricted: false,
          },
          contact: expect.any(String),
        },
        {
          matchedName: "Société Benjelloun Frères",
          matchedAs: "client",
          matter: { id: null, reference: theirMatter.reference, status: "open", restricted: false },
          contact: expect.stringContaining("Test User"),
        },
        {
          matchedName: "Leila Benjelloun",
          matchedAs: "opposing_party",
          matter: { id: null, reference: theirMatter.reference, status: "open", restricted: false },
          contact: expect.stringContaining("Test User"),
        },
      ]),
    );
    expect(JSON.stringify(found)).not.toContain("Ne doit pas apparaître");
  });

  it("hides names, references and status of restricted matters from non-members", async () => {
    const me = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const client = await createClient(colleague, { name: "Personnalité Publique" });
    const matter = await createMatter(colleague, client.id, { restricted: true });
    await addParty(colleague, matter.id, { name: "Partie Publique", role: "witness" });

    const found = await hits(me, "publique");
    expect(found).toHaveLength(2);
    for (const hit of found) {
      expect(hit.matchedName).toBeNull();
      expect(hit.matter).toEqual({ id: null, reference: null, status: null, restricted: true });
      expect(hit.contact).not.toBeNull();
    }
    // The members themselves see everything.
    const own = await hits(colleague, "publique");
    expect(own.every((h) => h.matter?.id === matter.id && h.matchedName !== null)).toBe(true);
  });

  it("reports clients recorded without a matter, with whom to ask", async () => {
    const me = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    await createClient(colleague, { name: "Nouveau Prospect" });
    expect(await hits(me, "prospect")).toEqual([
      {
        matchedName: "Nouveau Prospect",
        matchedAs: "client",
        matter: null,
        contact: expect.stringContaining("Test User"),
      },
    ]);
  });

  it("ignores accents, case and Arabic spelling variants, and matches identifiers without separators", async () => {
    const me = await person(ctx, "lawyer");
    const a = await createClient(me, { name: "Hélène Benâli", identifier: "BK-123.456" });
    await createMatter(me, a.id);
    const b = await createClient(me, { name: "إدريس العلوي" });
    await createMatter(me, b.id);

    expect((await hits(me, "HELENE BENALI")).map((h) => h.matchedName)).toEqual(["Hélène Benâli"]);
    expect((await hits(me, "bk 123456")).map((h) => h.matchedName)).toEqual(["Hélène Benâli"]);
    expect((await hits(me, "ادريس")).map((h) => h.matchedName)).toEqual(["إدريس العلوي"]);
  });

  it("is for lawyers only, needs at least three characters, and is audited without the searched text", async () => {
    const lawyer = await person(ctx, "lawyer");
    for (const role of ["assistant", "admin"] as const) {
      expect((await search(await person(ctx, role), "benali")).status).toBe(404);
    }
    expect((await search(new Browser(ctx), "benali")).status).toBe(401);
    for (const q of ["ab", " a ", "%%%", ""]) {
      expect((await search(lawyer, q)).status, q).toBe(400);
    }
    expect((await lawyer.browser.send("get", "/api/conflicts")).status).toBe(400);

    await hits(lawyer, "Secret Name");
    const events = (await auditActions(ctx)).filter((e) => e.action === "conflict.search");
    expect(events).toEqual([
      expect.objectContaining({ outcome: "success", metadata: { hits: 0, truncated: false } }),
    ]);
    expect(JSON.stringify(await auditActions(ctx)).toLowerCase()).not.toContain("secret");
  });

  it("returns at most 50 hits and says the list was cut", async () => {
    const me = await person(ctx, "lawyer");
    const client = await createClient(me, { name: "Groupe Témoin" });
    const matter = await createMatter(me, client.id);
    for (let i = 0; i < 55; i += 1) {
      await addParty(me, matter.id, { name: `Témoin ${i}`, role: "witness" });
    }
    const res = conflictResponseSchema.parse((await search(me, "temoin")).body);
    expect(res.hits).toHaveLength(50);
    expect(res.truncated).toBe(true);
  });

  it("slows down mass searching (rate limit per user)", async () => {
    const me = await person(ctx, "lawyer");
    await ctx.owner.query(
      "INSERT INTO rate_limit_bucket (key, count, reset_at) VALUES ($1, 60, now() + interval '10 minutes')",
      [`conflicts:user:${me.user.id}`],
    );
    const res = await search(me, "benali");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    const events = (await auditActions(ctx)).filter((e) => e.action === "conflict.search");
    expect(events.map((e) => e.outcome)).toEqual(["denied"]);
  });
});
