import {
  clientResponseSchema,
  clientListResponseSchema,
  matterListResponseSchema,
  matterResponseSchema,
  teamCandidatesResponseSchema,
} from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officeToday } from "../../modules/matters/office-date.js";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addMember,
  addParty,
  auditActions,
  createClient,
  createMatter,
  person,
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

describe("clients", () => {
  it("records a client, keeps it visible to its author only until a matter is opened", async () => {
    const lawyer = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const res = await lawyer.browser.send("post", "/api/clients", {
      kind: "company",
      name: "  Atlas Logistique SA ",
      identifier: "ice 001234567000089",
      email: " Contact@Atlas.TEST ",
      phone: "+212 522 00 00 00",
      address: "12 boulevard Zerktouni\nCasablanca",
      notes: "",
    });
    expect(res.status).toBe(201);
    const { client } = clientResponseSchema.parse(res.body);
    expect(client).toMatchObject({
      kind: "company",
      name: "Atlas Logistique SA",
      identifier: "ice 001234567000089",
      email: "contact@atlas.test",
      notes: null,
      matters: [],
      permissions: { update: true, openMatter: true },
    });
    const stored = await ctx.db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored.searchName).toBe("atlas logistique sa");
    expect(stored.searchIdentifier).toBe("ICE001234567000089");
    expect(stored.createdById).toBe(lawyer.user.id);

    expect((await colleague.browser.send("get", `/api/clients/${client.id}`)).status).toBe(404);

    const matter = await createMatter(lawyer, client.id);
    await addMember(lawyer, matter.id, colleague);
    const seen = clientResponseSchema.parse(
      (await colleague.browser.send("get", `/api/clients/${client.id}`)).body,
    );
    expect(seen.client.matters.map((m) => m.id)).toEqual([matter.id]);
    // A lawyer on the team may open further matters for this client.
    expect(seen.client.permissions).toEqual({ update: true, openMatter: true });
  });

  it("refuses fields the client may not set (mass assignment) and unsafe text", async () => {
    const lawyer = await person(ctx, "lawyer");
    const other = await person(ctx, "lawyer");
    const bad = [
      { kind: "person", name: "Ali", createdById: other.user.id },
      { kind: "person", name: "Ali", id: "00000000-0000-4000-8000-000000000000" },
      { kind: "person", name: "Ali", searchName: "someone else" },
      { kind: "robot", name: "Ali" },
      { kind: "person", name: "..." },
      { kind: "person", name: "" },
      { kind: "person", name: "x".repeat(201) },
      // Right-to-left override: would make "Ali" display as something else.
      { kind: "person", name: "Ali \u202eilA" },
      { kind: "person", name: "Ali\u0000" },
      { kind: "person", name: "Ali", email: "not an address" },
      { kind: "person", name: "Ali", phone: "call me maybe" },
      { kind: "person", name: "Ali", identifier: "<script>" },
      { kind: "person", name: "Ali", notes: "x".repeat(4001) },
    ];
    for (const body of bad) {
      const res = await lawyer.browser.send("post", "/api/clients", body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe("validation_failed");
    }
    expect(await ctx.db.client.count()).toBe(0);
  });

  it("is recorded by lawyers only (404 for assistants and administrators)", async () => {
    for (const role of ["assistant", "admin"] as const) {
      const p = await person(ctx, role);
      const res = await p.browser.send("post", "/api/clients", { kind: "person", name: "Ali" });
      expect(res.status).toBe(404);
    }
    expect(await ctx.db.client.count()).toBe(0);
  });

  it("updates only the fields sent, clears optional ones with null, and audits field names only", async () => {
    const lawyer = await person(ctx, "lawyer");
    const client = await createClient(lawyer, { phone: "0600000000", notes: "Rappeler lundi" });
    const res = await lawyer.browser.send("patch", `/api/clients/${client.id}`, {
      name: "Salma Berrada-Alaoui",
      notes: null,
    });
    expect(res.status).toBe(204);
    const stored = await ctx.db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored).toMatchObject({
      name: "Salma Berrada-Alaoui",
      searchName: "salma berrada alaoui",
      phone: "0600000000",
      notes: null,
    });
    const audit = (await auditActions(ctx)).filter((e) => e.action === "client.update");
    expect(audit).toEqual([
      {
        action: "client.update",
        outcome: "success",
        targetId: client.id,
        metadata: { fields: ["name", "notes"] },
      },
    ]);
    expect(JSON.stringify(await auditActions(ctx))).not.toContain("Berrada");
  });

  it("finds clients by name regardless of accents, case and Arabic spelling, within visible clients only", async () => {
    const lawyer = await person(ctx, "lawyer");
    const outsider = await person(ctx, "lawyer");
    await createClient(lawyer, { name: "Hélène Benâli" });
    await createClient(lawyer, { name: "أحمد الإدريسي" });
    await createClient(outsider, { name: "Hélène Benali" });

    const search = async (who: typeof lawyer, q: string) =>
      clientListResponseSchema
        .parse((await who.browser.send("get", `/api/clients?q=${encodeURIComponent(q)}`)).body)
        .clients.map((c) => c.name);

    expect(await search(lawyer, "HELENE BENALI")).toEqual(["Hélène Benâli"]);
    expect(await search(lawyer, "احمد الادريسي")).toEqual(["أحمد الإدريسي"]);
    // Wildcards are literal, not patterns.
    expect(await search(lawyer, "%")).toEqual([]);
    expect(await search(lawyer, "_")).toEqual([]);
    expect(await search(outsider, "benali")).toEqual(["Hélène Benali"]);
  });
});

describe("matters", () => {
  it("opens a matter with a yearly reference; the author leads it", async () => {
    const lawyer = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    const res = await lawyer.browser.send("post", "/api/matters", {
      clientId: client.id,
      title: "Litige commercial Atlas",
      area: "commercial",
      court: "Tribunal de commerce de Casablanca",
      courtCaseNumber: "2026/8201/112",
    });
    expect(res.status).toBe(201);
    const { matter } = matterResponseSchema.parse(res.body);
    const year = officeToday().slice(0, 4);
    expect(matter).toMatchObject({
      reference: `${year}-0001`,
      status: "open",
      restricted: false,
      openedOn: officeToday(),
      closedOn: null,
      myRole: "lead",
      lead: { id: lawyer.user.id },
      client: { id: client.id },
      permissions: {
        update: true,
        manageTeam: true,
        setRestricted: true,
        writeParties: true,
        updateClient: true,
        claimLead: false,
      },
    });
    expect(matter.members).toEqual([
      expect.objectContaining({ userId: lawyer.user.id, memberRole: "lead", active: true }),
    ]);
    const second = await createMatter(lawyer, client.id);
    expect(second.reference).toBe(`${year}-0002`);
  });

  it("gives every matter a different reference with no gaps, even when opened at the same moment", async () => {
    const lawyer = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        lawyer.browser.send("post", "/api/matters", {
          clientId: client.id,
          title: `Dossier ${i}`,
          area: "civil",
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(results.map(() => 201));
    const year = officeToday().slice(0, 4);
    const references = results
      .map((r) => matterResponseSchema.parse(r.body).matter.reference)
      .sort();
    expect(references).toEqual(
      Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(4, "0")}`),
    );
  });

  it("refuses server-owned fields, a client the lawyer cannot see, and future dates", async () => {
    const lawyer = await person(ctx, "lawyer");
    const outsider = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    const hidden = await createClient(outsider, { name: "Client caché" });
    const base = { clientId: client.id, title: "Dossier", area: "civil" };
    for (const extra of [
      { reference: "2026-9999" },
      { status: "closed" },
      { createdById: outsider.user.id },
      { members: [{ userId: outsider.user.id, role: "lead" }] },
      { closedOn: "2026-01-01" },
      { area: "space_law" },
    ]) {
      const res = await lawyer.browser.send("post", "/api/matters", { ...base, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const future = await lawyer.browser.send("post", "/api/matters", {
      ...base,
      openedOn: "2999-01-01",
    });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual([{ path: "openedOn", issue: "custom" }]);

    const other = await lawyer.browser.send("post", "/api/matters", {
      ...base,
      clientId: hidden.id,
    });
    expect(other.status).toBe(404);
    expect(await ctx.db.matter.count()).toBe(0);
  });

  it("closes and reopens a matter, keeping the closing date consistent", async () => {
    const lawyer = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    const matter = await createMatter(lawyer, client.id, { openedOn: "2026-01-15" });
    const path = `/api/matters/${matter.id}`;

    expect((await lawyer.browser.send("patch", path, { status: "closed" })).status).toBe(204);
    let detail = matterResponseSchema.parse((await lawyer.browser.send("get", path)).body).matter;
    expect(detail).toMatchObject({ status: "closed", closedOn: officeToday() });

    // The opening date cannot move after the closing date.
    const bad = await lawyer.browser.send("patch", path, { openedOn: "2999-01-01" });
    expect(bad.status).toBe(400);

    expect((await lawyer.browser.send("patch", path, { status: "open" })).status).toBe(204);
    detail = matterResponseSchema.parse((await lawyer.browser.send("get", path)).body).matter;
    expect(detail).toMatchObject({ status: "open", closedOn: null });

    const audit = (await auditActions(ctx)).filter((e) => e.action === "matter.update");
    expect(audit.map((e) => e.metadata)).toEqual([
      { fields: ["status"], status: { from: "open", to: "closed" } },
      { fields: ["status"], status: { from: "closed", to: "open" } },
    ]);
  });

  it("searches visible matters by title, reference and client name", async () => {
    const lawyer = await person(ctx, "lawyer");
    const outsider = await person(ctx, "lawyer");
    const client = await createClient(lawyer, { name: "Yasmine Tazi" });
    const first = await createMatter(lawyer, client.id, { title: "Bail commercial" });
    await createMatter(lawyer, client.id, { title: "Divorce" });
    const theirs = await createClient(outsider, { name: "Yasmine Tazi" });
    await createMatter(outsider, theirs.id, { title: "Bail commercial bis" });

    const titles = async (query: string) =>
      matterListResponseSchema
        .parse((await lawyer.browser.send("get", `/api/matters?${query}`)).body)
        .matters.map((m) => m.title)
        .sort();

    expect(await titles("q=bail")).toEqual(["Bail commercial"]);
    expect(await titles(`q=${first.reference}`)).toEqual(["Bail commercial"]);
    expect(await titles("q=TAZI")).toEqual(["Bail commercial", "Divorce"]);
    expect(await titles("status=closed")).toEqual([]);
    expect((await lawyer.browser.send("get", "/api/matters?status=lost")).status).toBe(400);
    expect((await lawyer.browser.send("get", "/api/matters?owner=me")).status).toBe(400);
  });

  it("pages through long lists", async () => {
    const lawyer = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    for (let i = 0; i < 27; i += 1) await createMatter(lawyer, client.id, { title: `D${i}` });
    const page = async (n: number) =>
      matterListResponseSchema.parse(
        (await lawyer.browser.send("get", `/api/matters?page=${n}`)).body,
      );
    expect((await page(1)).matters).toHaveLength(25);
    expect((await page(1)).hasMore).toBe(true);
    expect((await page(2)).matters).toHaveLength(2);
    expect((await page(2)).hasMore).toBe(false);
  });

  it("records an audit event for each change and for attempts on hidden matters", async () => {
    const lawyer = await person(ctx, "lawyer");
    const outsider = await person(ctx, "lawyer");
    const client = await createClient(lawyer);
    const matter = await createMatter(lawyer, client.id, { restricted: true });
    expect((await outsider.browser.send("get", `/api/matters/${matter.id}`)).status).toBe(404);

    const events = await auditActions(ctx);
    expect(events.map((e) => `${e.action}:${e.outcome}`)).toEqual(
      expect.arrayContaining([
        "client.create:success",
        "matter.create:success",
        "matter.access:denied",
      ]),
    );
    expect(events.find((e) => e.action === "matter.create")?.metadata).toEqual({
      reference: matter.reference,
      area: "family",
      restricted: true,
    });
  });
});

describe("team", () => {
  it("adds and removes members; access follows membership immediately", async () => {
    const lead = await person(ctx, "lawyer");
    const assistant = await person(ctx, "assistant");
    const admin = await person(ctx, "admin");
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    const path = `/api/matters/${matter.id}`;

    const candidates = teamCandidatesResponseSchema.parse(
      (await lead.browser.send("get", `${path}/candidates`)).body,
    );
    // Administrators are never offered; the lead is already on the team.
    expect(candidates.users.map((u) => u.id)).toEqual([assistant.user.id]);
    expect(
      (await lead.browser.send("post", `${path}/members`, { userId: admin.user.id })).status,
    ).toBe(404);

    expect((await assistant.browser.send("get", path)).status).toBe(404);
    await addMember(lead, matter.id, assistant);
    expect((await assistant.browser.send("get", path)).status).toBe(200);
    expect(
      (await lead.browser.send("post", `${path}/members`, { userId: assistant.user.id })).status,
    ).toBe(409);

    expect((await lead.browser.send("delete", `${path}/members/${assistant.user.id}`)).status).toBe(
      204,
    );
    expect((await assistant.browser.send("get", path)).status).toBe(404);
    // The lead cannot be removed; the lead must be handed over first.
    expect((await lead.browser.send("delete", `${path}/members/${lead.user.id}`)).status).toBe(409);
  });

  it("never adds disabled accounts", async () => {
    const lead = await person(ctx, "lawyer");
    const leaver = await person(ctx, "assistant");
    await ctx.db.user.update({ where: { id: leaver.user.id }, data: { disabledAt: new Date() } });
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    const res = await lead.browser.send("post", `/api/matters/${matter.id}/members`, {
      userId: leaver.user.id,
    });
    expect(res.status).toBe(404);
  });

  it("hands the lead only to an active lawyer on the team", async () => {
    const lead = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const assistant = await person(ctx, "assistant");
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    await addMember(lead, matter.id, assistant);
    const path = `/api/matters/${matter.id}/lead`;

    expect((await lead.browser.send("post", path, { userId: assistant.user.id })).status).toBe(409);
    expect((await lead.browser.send("post", path, { userId: colleague.user.id })).status).toBe(404);
    await addMember(lead, matter.id, colleague);
    expect((await lead.browser.send("post", path, { userId: colleague.user.id })).status).toBe(204);
    const detail = matterResponseSchema.parse(
      (await lead.browser.send("get", `/api/matters/${matter.id}`)).body,
    ).matter;
    expect(detail.lead?.id).toBe(colleague.user.id);
    expect(detail.myRole).toBe("member");
    expect(detail.permissions.manageTeam).toBe(false);
  });

  it("lets a lawyer on the team take over when the lead's account is disabled", async () => {
    const lead = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const assistant = await person(ctx, "assistant");
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    await addMember(lead, matter.id, colleague);
    await addMember(lead, matter.id, assistant);
    const path = `/api/matters/${matter.id}/lead`;

    // While the lead can act, nobody else can take over.
    expect((await colleague.browser.send("post", path, { userId: colleague.user.id })).status).toBe(
      403,
    );

    await ctx.db.user.update({ where: { id: lead.user.id }, data: { disabledAt: new Date() } });
    const before = matterResponseSchema.parse(
      (await colleague.browser.send("get", `/api/matters/${matter.id}`)).body,
    ).matter;
    expect(before.permissions.claimLead).toBe(true);
    expect(before.members.find((m) => m.userId === lead.user.id)?.active).toBe(false);

    // An assistant cannot take over, and a lawyer can only claim it for themselves.
    expect((await assistant.browser.send("post", path, { userId: assistant.user.id })).status).toBe(
      403,
    );
    expect((await colleague.browser.send("post", path, { userId: assistant.user.id })).status).toBe(
      403,
    );
    expect((await colleague.browser.send("post", path, { userId: colleague.user.id })).status).toBe(
      204,
    );
    const audit = (await auditActions(ctx)).filter((e) => e.action === "matter.lead.transfer");
    expect(audit.at(-1)?.metadata).toEqual({
      from: lead.user.id,
      to: colleague.user.id,
      claimed: true,
    });
  });
});

describe("team changes at the same moment", () => {
  it("hands the lead to only one of two lawyers when both hand-overs race", async () => {
    const lead = await person(ctx, "lawyer");
    const first = await person(ctx, "lawyer");
    const second = await person(ctx, "lawyer");
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    await addMember(lead, matter.id, first);
    await addMember(lead, matter.id, second);
    const path = `/api/matters/${matter.id}/lead`;

    const results = await Promise.all([
      lead.browser.send("post", path, { userId: first.user.id }),
      lead.browser.send("post", path, { userId: second.user.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    const leads = await ctx.db.matterMember.findMany({
      where: { matterId: matter.id, role: "lead" },
    });
    expect(leads).toHaveLength(1);
    expect([first.user.id, second.user.id]).toContain(leads[0]?.userId);
  });
});

describe("parties", () => {
  it("adds, edits and removes parties, keeping search keys in step", async () => {
    const lead = await person(ctx, "lawyer");
    const client = await createClient(lead);
    const matter = await createMatter(lead, client.id);
    const partyId = await addParty(lead, matter.id, {
      kind: "person",
      name: "Karim El Fassi",
      role: "opposing_party",
      identifier: "BE 123456",
    });
    const path = `/api/matters/${matter.id}/parties/${partyId}`;
    expect(
      (await lead.browser.send("patch", path, { name: "Karim El-Fassi", identifier: null })).status,
    ).toBe(204);
    expect(await ctx.db.party.findUniqueOrThrow({ where: { id: partyId } })).toMatchObject({
      name: "Karim El-Fassi",
      searchName: "karim el fassi",
      identifier: null,
      searchIdentifier: null,
    });
    expect((await lead.browser.send("patch", path, { matterId: matter.id })).status).toBe(400);
    expect((await lead.browser.send("delete", path)).status).toBe(204);
    expect((await lead.browser.send("delete", path)).status).toBe(404);
  });
});

describe("signed-out and cross-site requests", () => {
  it("rejects writes without the session's CSRF token", async () => {
    const lawyer = await person(ctx, "lawyer");
    const forged = new Browser(ctx);
    forged.sessionToken = lawyer.browser.sessionToken;
    const res = await forged.send("post", "/api/clients", { kind: "person", name: "Ali" });
    expect(res.status).toBe(403);
    expect(await ctx.db.client.count()).toBe(0);
  });
});
