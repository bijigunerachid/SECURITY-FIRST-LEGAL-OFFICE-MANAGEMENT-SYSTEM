import type { AuditEvent, MatterDetail, SecurityAlert } from "@lexora/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";

const ADMIN = { role: "admin" as const, mfaEnabled: true };
const ME = "11111111-1111-4111-8111-111111111111";
const LAWYER = "33333333-3333-4333-8333-333333333333";
const MATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALERT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "120",
  // The instant and the office time deliberately disagree: only the office time may be shown.
  occurredAt: "2026-10-30T08:15:00.000Z",
  occurredAtOffice: "2026-10-30T09:15:42",
  actor: { id: LAWYER, displayName: "Youssef Avocat" },
  action: "invoice.issue",
  targetType: "invoice",
  targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  outcome: "success",
  requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ipAddress: "192.0.2.10",
  metadata: { number: "F-2026-0001" },
  ...overrides,
});

const alert = (overrides: Partial<SecurityAlert> = {}): SecurityAlert => ({
  id: ALERT_ID,
  kind: "login_failures_account",
  severity: "high",
  subject: LAWYER,
  user: { id: LAWYER, displayName: "Youssef Avocat" },
  count: 7,
  firstSeenAt: "2026-10-30T08:00:00.000Z",
  lastSeenAt: "2026-10-30T08:10:00.000Z",
  firstSeenAtOffice: "2026-10-30T08:00:00",
  lastSeenAtOffice: "2026-10-30T08:10:00",
  status: "open",
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: "2026-10-30T08:10:05.000Z",
  ...overrides,
});

describe("audit-log viewer", () => {
  it("shows readable actions in office time, with details on request, and loads more", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(ADMIN),
      "GET /api/admin/alerts/count": jsonResponse(200, { unresolved: 0 }),
      "GET /api/admin/audit": jsonResponse(200, { events: [event()], nextBefore: "120" }),
      "GET /api/admin/audit?before=120": jsonResponse(200, {
        events: [
          event({
            id: "119",
            action: "some.future_action",
            outcome: "denied",
            actor: null,
            metadata: null,
          }),
        ],
        nextBefore: null,
      }),
    });
    renderRoute("/admin/audit");
    expect(await screen.findByText("Facture émise")).toBeInTheDocument();
    expect(screen.getByText(/09:15:42/)).toBeInTheDocument();
    expect(screen.queryByText(/08:15:00/)).not.toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toHaveAttribute("dir", "ltr");

    await userEvent.click(screen.getByText("Détails"));
    expect(screen.getByText(/F-2026-0001/)).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Afficher plus" }));
    // An action this version has no label for is shown by its code, never hidden.
    expect(await screen.findByText("some.future_action")).toBeInTheDocument();
    expect(screen.getByText("Refusé", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Afficher plus" })).not.toBeInTheDocument();
    expect(requests.filter((r) => r.path.startsWith("/api/admin/audit"))).toHaveLength(2);
  });

  it("filters through the address, keeping the person it was opened for", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(ADMIN),
      "GET /api/admin/alerts/count": jsonResponse(200, { unresolved: 0 }),
      [`GET /api/admin/audit?actorId=${LAWYER}`]: jsonResponse(200, {
        events: [event()],
        nextBefore: null,
      }),
      [`GET /api/admin/audit?action=auth.&outcome=failure&actorId=${LAWYER}`]: jsonResponse(200, {
        events: [],
        nextBefore: null,
      }),
    });
    renderRoute(`/admin/audit?actorId=${LAWYER}`);
    expect(await screen.findByText(/Affichage limité à une personne/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Type d'action"), "auth.");
    await userEvent.selectOptions(screen.getByLabelText("Résultat"), "failure");
    await userEvent.click(screen.getByRole("button", { name: "Filtrer" }));
    expect(await screen.findByText("Aucun événement ne correspond.")).toBeInTheDocument();
    expect(requests.at(-1)?.path).toBe(
      `/api/admin/audit?action=auth.&outcome=failure&actorId=${LAWYER}`,
    );
  });

  it("verifies the chain and says plainly when it is broken", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(ADMIN),
      "GET /api/admin/alerts/count": jsonResponse(200, { unresolved: 0 }),
      "GET /api/admin/audit": jsonResponse(200, { events: [], nextBefore: null }),
      "POST /api/admin/audit/verify": [
        jsonResponse(200, {
          verification: {
            valid: true,
            checked: 42,
            firstInvalidId: null,
            latestHash: "ab",
            verifiedAt: "2026-10-30T09:00:00.000Z",
          },
        }),
        jsonResponse(200, {
          verification: {
            valid: false,
            checked: 10,
            firstInvalidId: "11",
            latestHash: null,
            verifiedAt: "2026-10-30T09:01:00.000Z",
          },
        }),
      ],
    });
    renderRoute("/admin/audit");
    await userEvent.click(await screen.findByRole("button", { name: "Vérifier maintenant" }));
    expect(await screen.findByText(/Événements vérifiés : 42/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vérifier maintenant" }));
    expect(await screen.findByText(/rompue à l'événement 11/)).toBeInTheDocument();
  });
});

describe("alerts", () => {
  it("shows the count in the menu, and acknowledges then resolves with a note", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(ADMIN),
      "GET /api/admin/alerts/count": jsonResponse(200, { unresolved: 3 }),
      "GET /api/admin/alerts?view=unresolved&page=1": jsonResponse(200, {
        alerts: [alert()],
        page: 1,
        hasMore: false,
      }),
      [`POST /api/admin/alerts/${ALERT_ID}/acknowledge`]: jsonResponse(200, {
        alert: alert({ status: "acknowledged" }),
      }),
      [`POST /api/admin/alerts/${ALERT_ID}/resolve`]: [
        apiError(409, "conflict"),
        jsonResponse(200, { alert: alert({ status: "resolved" }) }),
      ],
    });
    renderRoute("/admin/alerts");
    const nav = await screen.findByRole("navigation", { name: "Navigation principale" });
    await screen.findByText("Échecs de connexion répétés sur un compte");
    expect(
      await within(nav).findByRole("link", { name: "Alertes (à traiter : 3)" }),
    ).toBeInTheDocument();

    expect(
      await screen.findByText("Échecs de connexion répétés sur un compte"),
    ).toBeInTheDocument();
    expect(screen.getByText(/pour ce compte : 7 en 15 minutes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir dans le journal d'audit" })).toHaveAttribute(
      "href",
      `/admin/audit?actorId=${LAWYER}`,
    );

    await userEvent.click(screen.getByRole("button", { name: /Prendre en compte/ }));
    await waitFor(() => {
      expect(requests.some((r) => r.path.endsWith("/acknowledge"))).toBe(true);
    });

    await userEvent.click(screen.getByRole("button", { name: /Résoudre/ }));
    const dialog = await screen.findByRole("dialog", { name: "Résoudre l'alerte" });
    await userEvent.type(within(dialog).getByLabelText("Ce qui a été fait"), "ok");
    await userEvent.click(within(dialog).getByRole("button", { name: "Résoudre" }));
    expect(requests.some((r) => r.path.endsWith("/resolve"))).toBe(false);
    await userEvent.type(
      within(dialog).getByLabelText("Ce qui a été fait"),
      " – confirmé par téléphone",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Résoudre" }));
    expect(await within(dialog).findByText(/déjà été traitée/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Résoudre" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(requests.filter((r) => r.path.endsWith("/resolve")).at(-1)?.body).toEqual({
      note: "ok – confirmé par téléphone",
    });
  });

  it("is not counted for people who are not administrators", async () => {
    const { requests } = mockApi({ "GET /api/auth/session": signedIn() });
    renderRoute("/");
    await screen.findByRole("navigation", { name: "Navigation principale" });
    expect(requests.some((r) => r.path.includes("/api/admin/"))).toBe(false);
  });
});

describe("matter history", () => {
  const matter = (readHistory: boolean): MatterDetail => ({
    id: MATTER_ID,
    reference: "2026-0007",
    title: "Succession Berrada",
    area: "family",
    status: "open",
    restricted: false,
    openedOn: "2026-03-02",
    client: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "person",
      name: "Salma",
      identifier: null,
    },
    lead: { id: ME, displayName: "Fatima El Amrani" },
    myRole: "lead",
    breakGlassUntil: null,
    court: null,
    courtCaseNumber: null,
    description: null,
    closedOn: null,
    createdAt: "2026-03-02T09:00:00.000Z",
    updatedAt: "2026-03-02T09:00:00.000Z",
    members: [],
    parties: [],
    permissions: {
      update: true,
      manageTeam: true,
      setRestricted: true,
      writeParties: false,
      updateClient: false,
      claimLead: false,
      writeDocuments: false,
      deleteDocuments: false,
      writeCalendar: false,
      deleteTasks: false,
      readBilling: false,
      draftInvoices: false,
      manageBilling: false,
      readHistory,
    },
  });

  it("is loaded only when the lead lawyer asks, and flags break-glass reads", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: matter(true) }),
      [`GET /api/matters/${MATTER_ID}/history`]: jsonResponse(200, {
        events: [
          {
            id: "9",
            occurredAt: "2026-10-30T08:00:00.000Z",
            occurredAtOffice: "2026-10-30T08:00:00",
            actor: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", displayName: "Admin Bureau" },
            action: "matter.read",
            outcome: "success",
            targetType: "matter",
            fields: null,
            breakGlass: true,
          },
          {
            id: "8",
            occurredAt: "2026-10-29T08:00:00.000Z",
            occurredAtOffice: "2026-10-29T08:00:00",
            actor: { id: ME, displayName: "Fatima El Amrani" },
            action: "matter.update",
            outcome: "success",
            targetType: "matter",
            fields: ["title", "court"],
            breakGlass: false,
          },
        ],
        nextBefore: null,
      }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    const section = (await screen.findByRole("heading", { name: "Historique du dossier" })).closest(
      "section",
    );
    if (!section) throw new Error("no history section");
    expect(requests.some((r) => r.path.endsWith("/history"))).toBe(false);
    await userEvent.click(within(section).getByRole("button", { name: "Afficher l'historique" }));
    expect(
      await within(section).findByText("Dossier consulté (accès d'urgence)"),
    ).toBeInTheDocument();
    expect(within(section).getByText("Accès d'urgence")).toBeInTheDocument();
    expect(within(section).getByText("Champs : title, court")).toBeInTheDocument();
  });

  it("is absent for anyone who is not the lead lawyer", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: matter(false) }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Historique du dossier" }),
    ).not.toBeInTheDocument();
  });
});
