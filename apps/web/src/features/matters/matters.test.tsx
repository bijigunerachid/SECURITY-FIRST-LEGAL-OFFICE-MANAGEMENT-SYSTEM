import type { ConflictHit, MatterDetail, MatterSummary } from "@lexora/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";

const MATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ME = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
const ASSISTANT = "33333333-3333-4333-8333-333333333333";

const summary = (overrides: Partial<MatterSummary> = {}): MatterSummary => ({
  id: MATTER_ID,
  reference: "2026-0007",
  title: "Succession Berrada",
  area: "family",
  status: "open",
  restricted: false,
  openedOn: "2026-03-02",
  client: { id: CLIENT_ID, kind: "person", name: "Salma Berrada", identifier: null },
  lead: { id: ME, displayName: "Fatima El Amrani" },
  myRole: "lead",
  breakGlassUntil: null,
  ...overrides,
});

const allowed = {
  update: true,
  manageTeam: true,
  setRestricted: true,
  writeParties: true,
  updateClient: true,
  claimLead: false,
};

const detail = (overrides: Partial<MatterDetail> = {}): MatterDetail => ({
  ...summary(),
  court: "Tribunal de première instance de Rabat",
  courtCaseNumber: "2026/1201/55",
  description: null,
  closedOn: null,
  createdAt: "2026-03-02T09:00:00.000Z",
  updatedAt: "2026-03-02T09:00:00.000Z",
  members: [
    {
      userId: ME,
      displayName: "Fatima El Amrani",
      role: "lawyer",
      memberRole: "lead",
      active: true,
    },
    {
      userId: COLLEAGUE,
      displayName: "Omar Tazi",
      role: "lawyer",
      memberRole: "member",
      active: true,
    },
  ],
  parties: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      kind: "company",
      name: "Atlas Immobilier SARL",
      role: "opposing_party",
      identifier: null,
      notes: null,
    },
  ],
  permissions: allowed,
  ...overrides,
});

describe("navigation by role", () => {
  it.each([
    ["lawyer", ["Dossiers", "Clients", "Conflits d'intérêts"], ["Utilisateurs", "Accès d'urgence"]],
    ["assistant", ["Dossiers", "Clients"], ["Conflits d'intérêts", "Accès d'urgence"]],
    ["admin", ["Utilisateurs", "Accès d'urgence"], ["Dossiers", "Clients", "Conflits d'intérêts"]],
  ] as const)("%s sees only their sections", async (role, shown, hidden) => {
    mockApi({ "GET /api/auth/session": signedIn({ role, mfaEnabled: role === "admin" }) });
    renderRoute("/");
    const nav = await screen.findByRole("navigation", { name: "Navigation principale" });
    for (const name of shown) expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    for (const name of hidden) expect(within(nav).queryByRole("link", { name })).toBeNull();
  });
});

describe("matters list", () => {
  it("lists matters with status and confidentiality; only lawyers can open new ones", async () => {
    mockApi({
      "GET /api/auth/session": signedIn({ role: "assistant" }),
      "GET /api/matters?page=1": jsonResponse(200, {
        matters: [summary({ restricted: true, myRole: "member" })],
        page: 1,
        hasMore: false,
      }),
    });
    renderRoute("/matters");
    const link = await screen.findByRole("link", { name: /Succession Berrada/ });
    expect(link).toHaveAttribute("href", `/matters/${MATTER_ID}`);
    expect(within(link).getByText("Confidentiel")).toBeInTheDocument();
    expect(within(link).getByText("En cours")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nouveau dossier" })).toBeNull();
  });

  it("searches through the address and shows an empty result", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/matters?page=1": jsonResponse(200, { matters: [], page: 1, hasMore: false }),
      "GET /api/matters?q=bail&page=1": jsonResponse(200, {
        matters: [],
        page: 1,
        hasMore: false,
      }),
    });
    const { router } = renderRoute("/matters");
    expect(await screen.findByText("Aucun dossier pour l'instant.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nouveau dossier" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Rechercher un dossier"), "bail");
    await userEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(
      await screen.findByText("Aucun dossier ne correspond à cette recherche."),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe("?q=bail");
    expect(requests.some((r) => r.path === "/api/matters?q=bail&page=1")).toBe(true);
  });
});

describe("matter page", () => {
  it("offers the lead every action", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: detail() }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Succession Berrada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vous êtes responsable de ce dossier.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier les informations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter à l'équipe" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retirer Omar Tazi de l'équipe" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Modifier Atlas Immobilier SARL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Salma Berrada" })).toHaveAttribute(
      "href",
      `/clients/${CLIENT_ID}`,
    );
  });

  it("shows an administrator's emergency access as read-only, with no actions", async () => {
    const none = Object.fromEntries(Object.keys(allowed).map((k) => [k, false]));
    mockApi({
      "GET /api/auth/session": signedIn({ role: "admin", mfaEnabled: true }),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, {
        matter: detail({
          myRole: null,
          breakGlassUntil: "2026-03-02T10:00:00.000Z",
          permissions: none as MatterDetail["permissions"],
        }),
      }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    expect(await screen.findByText(/Accès d'urgence en lecture seule/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Modifier|Ajouter|Retirer/ })).toBeNull();
  });

  it("says a matter is not found, without telling whether it exists", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: apiError(404, "not_found"),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    expect(await screen.findByRole("heading", { name: "Dossier introuvable" })).toBeInTheDocument();
    expect(
      screen.getByText("Ce dossier n'existe pas ou vous n'en faites pas partie."),
    ).toBeInTheDocument();
  });

  it("adds the person shown by default when the lead confirms without changing the choice", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: detail() }),
      [`GET /api/matters/${MATTER_ID}/candidates`]: jsonResponse(200, {
        users: [{ id: ASSISTANT, displayName: "Nadia Assistante", role: "assistant" }],
      }),
      [`POST /api/matters/${MATTER_ID}/members`]: jsonResponse(204, null),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Ajouter à l'équipe" }));
    const dialog = await screen.findByRole("dialog", { name: "Ajouter une personne à l'équipe" });
    expect(
      await within(dialog).findByRole("option", { name: /Nadia Assistante/ }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => {
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({ userId: ASSISTANT });
    });
  });

  it("explains a refused lead removal in plain words", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: detail() }),
      [`DELETE /api/matters/${MATTER_ID}/members/${COLLEAGUE}`]: apiError(409, "conflict"),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Retirer Omar Tazi de l'équipe" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuer" }));
    expect(
      await within(dialog).findByText(
        "Confiez d'abord la responsabilité du dossier à quelqu'un d'autre.",
      ),
    ).toBeInTheDocument();
  });

  it("lets a team lawyer edit details, but not the confidentiality setting", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn({ id: COLLEAGUE }),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, {
        matter: detail({
          myRole: "member",
          permissions: { ...allowed, manageTeam: false, setRestricted: false },
        }),
      }),
      [`PATCH /api/matters/${MATTER_ID}`]: jsonResponse(204, null),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Modifier les informations" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Dossier confidentiel")).toBeDisabled();
    const title = within(dialog).getByLabelText("Intitulé du dossier");
    await userEvent.clear(title);
    await userEvent.type(title, "Succession Berrada (appel)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(requests.find((r) => r.method === "PATCH")?.body).toMatchObject({
        title: "Succession Berrada (appel)",
      });
    });
    expect(requests.find((r) => r.method === "PATCH")?.body).not.toHaveProperty("restricted");
  });
});

describe("conflict search", () => {
  const hits: ConflictHit[] = [
    {
      matchedName: "Omar Benjelloun",
      matchedAs: "client",
      matter: { id: MATTER_ID, reference: "2026-0007", status: "open", restricted: false },
      contact: "Fatima El Amrani",
    },
    {
      matchedName: "Leila Benjelloun",
      matchedAs: "opposing_party",
      matter: { id: null, reference: "2026-0003", status: "closed", restricted: false },
      contact: "Omar Tazi",
    },
    {
      matchedName: null,
      matchedAs: "witness",
      matter: { id: null, reference: null, status: null, restricted: true },
      contact: "Omar Tazi",
    },
  ];

  it("shows what each hit may reveal, and links only to matters the user can open", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/conflicts?q=benjelloun": jsonResponse(200, { hits, truncated: false }),
    });
    renderRoute("/conflicts");
    await userEvent.type(
      await screen.findByLabelText("Nom, raison sociale ou identifiant"),
      "benjelloun",
    );
    await userEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(await screen.findByText("3 correspondances pour « benjelloun »")).toBeInTheDocument();
    expect(screen.getByText("Correspondance dans un dossier confidentiel")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ouvrir le dossier" })).toHaveLength(1);
    expect(screen.getByText("2026-0003")).toBeInTheDocument();
    expect(screen.getAllByText("À voir avec : Omar Tazi")).toHaveLength(2);
  });

  it("does not search with fewer than three characters", async () => {
    const { requests } = mockApi({ "GET /api/auth/session": signedIn() });
    renderRoute("/conflicts");
    await userEvent.type(await screen.findByLabelText("Nom, raison sociale ou identifiant"), "ab");
    await userEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(requests.some((r) => r.path.startsWith("/api/conflicts"))).toBe(false);
  });

  it("is not available to assistants", async () => {
    mockApi({ "GET /api/auth/session": signedIn({ role: "assistant" }) });
    renderRoute("/conflicts");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
  });
});

describe("new matter", () => {
  it("requires a conflict check for a new client, then records the client and opens the matter", async () => {
    const created = detail({ id: MATTER_ID, reference: "2026-0008" });
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/clients?page=1": jsonResponse(200, { clients: [], page: 1, hasMore: false }),
      "GET /api/conflicts?q=Youssef+Alaoui": jsonResponse(200, { hits: [], truncated: false }),
      "POST /api/clients": jsonResponse(201, {
        client: {
          id: CLIENT_ID,
          kind: "person",
          name: "Youssef Alaoui",
          identifier: null,
          email: null,
          phone: null,
          address: null,
          notes: null,
          createdAt: "2026-03-02T09:00:00.000Z",
          updatedAt: "2026-03-02T09:00:00.000Z",
          matters: [],
          permissions: { update: true, openMatter: true },
        },
      }),
      "POST /api/matters": jsonResponse(201, { matter: created }),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: created }),
    });
    const { router } = renderRoute("/matters/new");
    await userEvent.click(await screen.findByRole("radio", { name: "Nouveau client" }));
    await userEvent.type(screen.getByLabelText("Nom ou raison sociale"), "Youssef Alaoui");
    await userEvent.type(screen.getByLabelText("Intitulé du dossier"), "Litige locatif");

    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier" }));
    expect(
      await screen.findByText(
        "Lancez la recherche de conflits sur le nom du nouveau client avant d'ouvrir le dossier.",
      ),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Rechercher les conflits" }));
    expect(
      await screen.findByText("Aucune correspondance pour « Youssef Alaoui »."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Lancez la recherche de conflits/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/matters/${MATTER_ID}`);
    });
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.path)).toEqual(["/api/clients", "/api/matters"]);
    expect(posts[1]?.body).toMatchObject({
      clientId: CLIENT_ID,
      title: "Litige locatif",
      restricted: false,
    });
  });

  it("is only for lawyers", async () => {
    mockApi({ "GET /api/auth/session": signedIn({ role: "assistant" }) });
    renderRoute("/matters/new");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
  });
});

describe("break-glass page", () => {
  it("asks for the password and code, then opens the matter", async () => {
    const grant = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      matterId: MATTER_ID,
      reference: "2026-0007",
      reason: "Avocat injoignable, audience demain matin.",
      createdAt: "2026-03-02T09:00:00.000Z",
      expiresAt: "2026-03-02T10:00:00.000Z",
    };
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn({ role: "admin", mfaEnabled: true }),
      "GET /api/break-glass": jsonResponse(200, { grants: [] }),
      "POST /api/break-glass": [
        apiError(403, "reauthentication_required"),
        jsonResponse(201, { grant }),
      ],
      "POST /api/auth/reauth": jsonResponse(204, null),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, {
        matter: detail({ myRole: null, breakGlassUntil: grant.expiresAt }),
      }),
    });
    const { router } = renderRoute("/admin/break-glass");
    expect(await screen.findByText("Aucun accès d'urgence en cours.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Référence du dossier"), "2026-0007");
    await userEvent.type(screen.getByLabelText("Motif"), grant.reason);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir l'accès d'urgence" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.type(within(dialog).getByLabelText("Code de vérification"), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/matters/${MATTER_ID}`);
    });
    expect(
      requests.filter((r) => r.path === "/api/break-glass" && r.method === "POST"),
    ).toHaveLength(2);
  });

  it("refuses a short reason before asking the server", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn({ role: "admin", mfaEnabled: true }),
      "GET /api/break-glass": jsonResponse(200, { grants: [] }),
    });
    renderRoute("/admin/break-glass");
    await userEvent.type(await screen.findByLabelText("Référence du dossier"), "2026-0007");
    await userEvent.type(screen.getByLabelText("Motif"), "urgent");
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir l'accès d'urgence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Au moins 20 caractères");
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });
});
