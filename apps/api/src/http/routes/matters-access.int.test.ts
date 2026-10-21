import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addMember,
  addParty,
  createClient,
  createMatter,
  person,
  type Person,
} from "../../test/matters.js";

/**
 * The IDOR/BOLA grid (threat T5): every kind of user × every client and
 * matter endpoint, on one matter. A record the user cannot see answers 404;
 * a visible record on which the action is not allowed answers 403. After
 * each refused attempt, the database must be unchanged.
 */

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

interface World {
  lead: Person;
  memberLawyer: Person;
  memberAssistant: Person;
  spare: Person;
  matterId: string;
  clientId: string;
  partyId: string;
}

async function buildWorld(): Promise<World> {
  const lead = await person(ctx, "lawyer");
  // With a second factor, so the "promoted to administrator" case can sign in.
  const memberLawyer = await person(ctx, "lawyer", { mfa: true });
  const memberAssistant = await person(ctx, "assistant");
  const spare = await person(ctx, "assistant");
  const client = await createClient(lead, { phone: "+212 600 000 001" });
  const matter = await createMatter(lead, client.id);
  await addMember(lead, matter.id, memberLawyer);
  await addMember(lead, matter.id, memberAssistant);
  const partyId = await addParty(lead, matter.id);
  return {
    lead,
    memberLawyer,
    memberAssistant,
    spare,
    matterId: matter.id,
    clientId: client.id,
    partyId,
  };
}

type Endpoint = [name: string, call: (b: Browser, w: World) => ReturnType<Browser["send"]>];

/**
 * Ordered so that a successful change never hides the result of a later
 * check: removals and the lead transfer come last.
 */
const endpoints: Endpoint[] = [
  ["read matter", (b, w) => b.send("get", `/api/matters/${w.matterId}`)],
  ["edit matter", (b, w) => b.send("patch", `/api/matters/${w.matterId}`, { title: "Changed" })],
  [
    "restrict matter",
    (b, w) => b.send("patch", `/api/matters/${w.matterId}`, { restricted: true }),
  ],
  ["list team candidates", (b, w) => b.send("get", `/api/matters/${w.matterId}/candidates`)],
  [
    "add team member",
    (b, w) => b.send("post", `/api/matters/${w.matterId}/members`, { userId: w.spare.user.id }),
  ],
  [
    "add party",
    (b, w) =>
      b.send("post", `/api/matters/${w.matterId}/parties`, {
        kind: "person",
        name: "Témoin Un",
        role: "witness",
      }),
  ],
  [
    "edit party",
    (b, w) =>
      b.send("patch", `/api/matters/${w.matterId}/parties/${w.partyId}`, { notes: "changed" }),
  ],
  ["read client", (b, w) => b.send("get", `/api/clients/${w.clientId}`)],
  [
    "edit client",
    (b, w) => b.send("patch", `/api/clients/${w.clientId}`, { phone: "+212 600 000 999" }),
  ],
  [
    "open a matter for the client",
    (b, w) =>
      b.send("post", "/api/matters", { clientId: w.clientId, title: "Second", area: "civil" }),
  ],
  [
    "remove team member",
    (b, w) => b.send("delete", `/api/matters/${w.matterId}/members/${w.memberAssistant.user.id}`),
  ],
  ["remove party", (b, w) => b.send("delete", `/api/matters/${w.matterId}/parties/${w.partyId}`)],
  [
    "hand over the lead",
    (b, w) => b.send("post", `/api/matters/${w.matterId}/lead`, { userId: w.memberLawyer.user.id }),
  ],
];

const LEAD = [200, 204, 204, 200, 204, 201, 204, 200, 204, 201, 204, 204, 204];
const MEMBER_LAWYER = [200, 204, 403, 403, 403, 201, 204, 200, 204, 201, 403, 204, 403];
// Assistants: no matter edits, no team changes; cannot open matters (route is lawyers-only).
const MEMBER_ASSISTANT = [200, 403, 403, 403, 403, 201, 204, 200, 204, 404, 403, 204, 403];
const INVISIBLE = endpoints.map(() => 404);
// Break-glass is read-only: reads succeed, every change is refused.
const BREAK_GLASS = [200, 403, 403, 403, 403, 403, 403, 200, 403, 404, 403, 403, 403];

/** Everything the grid could change, to prove refused attempts change nothing. */
async function snapshot(w: World) {
  const [matter, client, members, parties] = await Promise.all([
    ctx.db.matter.findUniqueOrThrow({ where: { id: w.matterId } }),
    ctx.db.client.findUniqueOrThrow({ where: { id: w.clientId } }),
    ctx.db.matterMember.findMany({ orderBy: { userId: "asc" } }),
    ctx.db.party.findMany({ orderBy: { id: "asc" } }),
  ]);
  const matterCount = await ctx.db.matter.count();
  return { matter, client, members, parties, matterCount };
}

async function expectGrid(who: (w: World) => Browser | Promise<Browser>, expected: number[]) {
  const world = await buildWorld();
  const browser = await who(world);
  const before = await snapshot(world);
  const results: Record<string, number> = {};
  for (const [name, call] of endpoints) {
    results[name] = (await call(browser, world)).status;
  }
  expect(results).toEqual(Object.fromEntries(endpoints.map(([name], i) => [name, expected[i]])));
  return { world, before, after: await snapshot(world) };
}

describe("access grid: every kind of user against every matter and client endpoint", () => {
  it("lead lawyer: everything", async () => {
    await expectGrid((w) => w.lead.browser, LEAD);
  });

  it("lawyer on the team: works on the matter, cannot manage the team or restrict it", async () => {
    await expectGrid((w) => w.memberLawyer.browser, MEMBER_LAWYER);
  });

  it("assistant on the team: parties and client details only", async () => {
    await expectGrid((w) => w.memberAssistant.browser, MEMBER_ASSISTANT);
  });

  for (const role of ["lawyer", "assistant"] as const) {
    it(`${role} outside the team: sees nothing (404) and changes nothing`, async () => {
      const { before, after } = await expectGrid(
        async () => (await person(ctx, role)).browser,
        INVISIBLE,
      );
      expect(after).toEqual(before);
    });
  }

  it("administrator without break-glass access: sees nothing and changes nothing", async () => {
    const { before, after } = await expectGrid(
      async () => (await person(ctx, "admin", { reauth: true })).browser,
      INVISIBLE,
    );
    expect(after).toEqual(before);
  });

  it("administrator who was a team member before becoming administrator: no access", async () => {
    const { before, after } = await expectGrid(async (w) => {
      // Promote the team lawyer directly in the database, then sign in again.
      await ctx.db.user.update({ where: { id: w.memberLawyer.user.id }, data: { role: "admin" } });
      const browser = new Browser(ctx);
      await browser.signIn(w.memberLawyer.user);
      return browser;
    }, INVISIBLE);
    expect(after).toEqual(before);
  });

  it("administrator with break-glass access: reads only", async () => {
    const { before, after } = await expectGrid(async (w) => {
      const admin = await person(ctx, "admin", { reauth: true });
      const matter = await ctx.db.matter.findUniqueOrThrow({ where: { id: w.matterId } });
      const res = await admin.browser.send("post", "/api/break-glass", {
        reference: matter.reference,
        reason: "Lead lawyer unreachable; hearing tomorrow morning.",
      });
      expect(res.status).toBe(201);
      return admin.browser;
    }, BREAK_GLASS);
    expect(after).toEqual(before);
  });

  it("signed out: 401 everywhere", async () => {
    await expectGrid(
      () => new Browser(ctx),
      endpoints.map(() => 401),
    );
  });
});

describe("lists and IDs from other matters", () => {
  it("lists only what the user can see", async () => {
    const world = await buildWorld();
    const outsider = await person(ctx, "lawyer");
    const own = await createClient(outsider, { name: "Client Du Voisin" });
    await createMatter(outsider, own.id, { title: "Dossier du voisin" });

    const listed = async (p: Person) => {
      const matters = (await p.browser.send("get", "/api/matters")).body as {
        matters: { id: string }[];
      };
      const clients = (await p.browser.send("get", "/api/clients")).body as {
        clients: { id: string }[];
      };
      return { matters: matters.matters.length, clients: clients.clients.length };
    };
    expect(await listed(world.lead)).toEqual({ matters: 1, clients: 1 });
    expect(await listed(world.memberAssistant)).toEqual({ matters: 1, clients: 1 });
    expect(await listed(outsider)).toEqual({ matters: 1, clients: 1 });
    expect(await listed(world.spare)).toEqual({ matters: 0, clients: 0 });
    const admin = await person(ctx, "admin");
    expect(await listed(admin)).toEqual({ matters: 0, clients: 0 });
  });

  it("refuses a party ID from another matter, even to a member of both", async () => {
    const world = await buildWorld();
    const other = await createMatter(world.lead, world.clientId, { title: "Autre dossier" });
    const otherParty = await addParty(world.lead, other.id, { name: "Autre Partie" });

    const wrongPair = `/api/matters/${world.matterId}/parties/${otherParty}`;
    expect((await world.lead.browser.send("patch", wrongPair, { notes: "x" })).status).toBe(404);
    expect((await world.lead.browser.send("delete", wrongPair)).status).toBe(404);
    expect(await ctx.db.party.findUnique({ where: { id: otherParty } })).not.toBeNull();
  });

  it("answers malformed and unknown IDs with 404", async () => {
    const world = await buildWorld();
    for (const path of [
      "/api/matters/not-a-uuid",
      "/api/matters/00000000-0000-4000-8000-000000000000",
      "/api/clients/1%20OR%201=1",
      `/api/matters/${world.matterId}/parties/../members`,
    ]) {
      expect((await world.lead.browser.send("get", path)).status, path).toBe(404);
    }
  });
});
