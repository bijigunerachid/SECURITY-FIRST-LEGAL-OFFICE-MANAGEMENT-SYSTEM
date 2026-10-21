import type { Hearing, MatterDetail, MatterTask } from "@lexora/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { officeToday } from "@/features/matters/queries";
import { jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";
import { addDays } from "./queries";

const MATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const NADIA = "33333333-3333-4333-8333-333333333333";
const BASE = `/api/matters/${MATTER_ID}`;

const permissions = {
  update: true,
  manageTeam: true,
  setRestricted: true,
  writeParties: true,
  updateClient: true,
  claimLead: false,
  writeDocuments: true,
  deleteDocuments: true,
  writeCalendar: true,
  deleteTasks: true,
};

const matter = (overrides: Partial<typeof permissions> = {}): MatterDetail => ({
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
  court: "Tribunal de première instance de Rabat",
  courtCaseNumber: null,
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
      userId: NADIA,
      displayName: "Nadia Assistante",
      role: "assistant",
      memberRole: "member",
      active: true,
    },
  ],
  parties: [],
  permissions: { ...permissions, ...overrides },
});

const hearing: Hearing = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  matterId: MATTER_ID,
  startsAt: "2026-11-03T08:30:00.000Z",
  startsAtLocal: "2026-11-03T09:30",
  title: "Audience de plaidoirie",
  court: "Tribunal de première instance de Rabat",
  room: "Salle 2",
  notes: null,
  status: "scheduled",
  outcome: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
};

const task = (overrides: Partial<MatterTask> = {}): MatterTask => ({
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  matterId: MATTER_ID,
  kind: "deadline",
  title: "Délai d'appel",
  dueOn: "2026-11-10",
  notes: null,
  assignee: null,
  completedAt: null,
  completedBy: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  ...overrides,
});

function setUp(
  overrides: Partial<typeof permissions> = {},
  extra: Parameters<typeof mockApi>[0] = {},
) {
  return mockApi({
    "GET /api/auth/session": signedIn(),
    "GET /api/notifications": jsonResponse(200, { notifications: [], unread: 0 }),
    [`GET ${BASE}`]: jsonResponse(200, { matter: matter(overrides) }),
    [`GET ${BASE}/hearings`]: jsonResponse(200, { hearings: [hearing] }),
    [`GET ${BASE}/tasks`]: jsonResponse(200, { tasks: [task()] }),
    [`GET ${BASE}/documents`]: jsonResponse(200, { documents: [] }),
    ...extra,
  });
}

describe("hearings on the matter page", () => {
  it("shows hearings in office time, whatever the device's time zone", async () => {
    setUp();
    renderRoute(`/matters/${MATTER_ID}`);
    const section = await screen.findByRole("region", { name: "Audiences" });
    expect(await within(section).findByText("Audience de plaidoirie")).toBeInTheDocument();
    // 08:30 UTC is 09:30 in Casablanca in November.
    expect(within(section).getByText(/mardi 3 novembre 2026.*09:30/)).toBeInTheDocument();
    expect(within(section).getByText("Prévue")).toBeInTheDocument();
  });

  it("sends the office wall-clock time when adding a hearing", async () => {
    const { requests } = setUp(
      {},
      {
        [`POST ${BASE}/hearings`]: jsonResponse(201, { hearing }),
      },
    );
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Ajouter une audience" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle audience" });
    const when = within(dialog).getByLabelText("Date et heure (heure du Maroc)");
    await userEvent.clear(when);
    await userEvent.type(when, "2026-12-01T10:15");
    await userEvent.type(within(dialog).getByLabelText("Objet"), "Mise en état");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({
        startsAt: "2026-12-01T10:15",
        title: "Mise en état",
        court: "Tribunal de première instance de Rabat",
      });
    });
  });

  it("refuses an outcome on a hearing that is still scheduled, without asking the server", async () => {
    const { requests } = setUp();
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Modifier l'audience « Audience de plaidoirie »" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Modifier l'audience" });
    await userEvent.type(within(dialog).getByLabelText("Résultat (facultatif)"), "Renvoyée");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("À remplir une fois");
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });
});

describe("deadlines and tasks on the matter page", () => {
  it("marks a deadline done", async () => {
    const { requests } = setUp(
      {},
      {
        [`PATCH ${BASE}/tasks/${task().id}`]: jsonResponse(200, {
          task: task({ completedAt: "2026-11-01T10:00:00.000Z" }),
        }),
      },
    );
    renderRoute(`/matters/${MATTER_ID}`);
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "« Délai d'appel » est fait(e)" }),
    );
    await waitFor(() => {
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ completed: true });
    });
  });

  it("needs a date for a deadline before sending", async () => {
    const { requests } = setUp();
    renderRoute(`/matters/${MATTER_ID}`);
    const section = await screen.findByRole("region", { name: "Échéances et tâches" });
    await userEvent.click(within(section).getByRole("button", { name: "Ajouter" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle échéance ou tâche" });
    await userEvent.type(within(dialog).getByLabelText("Intitulé"), "Dépôt des conclusions");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("offers assignment only to active team members", async () => {
    setUp();
    renderRoute(`/matters/${MATTER_ID}`);
    const section = await screen.findByRole("region", { name: "Échéances et tâches" });
    await userEvent.click(within(section).getByRole("button", { name: "Ajouter" }));
    const dialog = await screen.findByRole("dialog");
    const options = within(within(dialog).getByLabelText("Attribuée à")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Personne en particulier",
      "Fatima El Amrani",
      "Nadia Assistante",
    ]);
  });

  it("shows no delete button to assistants, and nothing to change to read-only access", async () => {
    setUp({ deleteTasks: false });
    renderRoute(`/matters/${MATTER_ID}`);
    const section = await screen.findByRole("region", { name: "Échéances et tâches" });
    await within(section).findByText("Délai d'appel");
    expect(within(section).queryByRole("button", { name: /Supprimer/ })).toBeNull();
  });
});

describe("agenda", () => {
  it("lists what is due, by day, with overdue items first and links to the matters", async () => {
    const today = officeToday();
    const to = addDays(today, 29);
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/notifications": jsonResponse(200, { notifications: [], unread: 0 }),
      [`GET /api/agenda?from=${today}&to=${to}`]: jsonResponse(200, {
        hearings: [
          {
            ...hearing,
            startsAt: `${addDays(today, 2)}T08:30:00.000Z`,
            startsAtLocal: `${addDays(today, 2)}T09:30`,
            matter: { id: MATTER_ID, reference: "2026-0007", title: "Succession Berrada" },
          },
        ],
        tasks: [
          {
            ...task({ dueOn: addDays(today, 5) }),
            matter: { id: MATTER_ID, reference: "2026-0007", title: "Succession Berrada" },
          },
        ],
        overdue: [
          {
            ...task({ title: "Pièces à déposer", dueOn: addDays(today, -2) }),
            matter: { id: MATTER_ID, reference: "2026-0007", title: "Succession Berrada" },
          },
        ],
      }),
    });
    renderRoute("/agenda");
    const overdue = await screen.findByRole("region", { name: "En retard" });
    expect(within(overdue).getByText("Pièces à déposer")).toBeInTheDocument();
    expect(screen.getByText(/Audience — Audience de plaidoirie/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /Dossier .?2026-0007.? · Succession Berrada/ })[0],
    ).toHaveAttribute("href", `/matters/${MATTER_ID}`);
    // The reference is isolated left-to-right, so Arabic text cannot reverse it.
    const link = screen.getAllByRole("link", { name: /2026-0007/ })[0];
    expect(link?.textContent).toContain(
      `${String.fromCodePoint(0x2066)}2026-0007${String.fromCodePoint(0x2069)}`,
    );
  });

  it("is for lawyers and assistants", async () => {
    mockApi({ "GET /api/auth/session": signedIn({ role: "admin", mfaEnabled: true }) });
    renderRoute("/agenda");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeInTheDocument();
  });
});

describe("reminders", () => {
  const notification = {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    kind: "deadline_soon",
    stage: "2d",
    dueAt: "2026-11-10T00:00:00.000Z",
    createdAt: "2026-11-08T07:00:00.000Z",
    read: false,
    matter: { id: MATTER_ID, reference: "2026-0007", title: "Succession Berrada" },
    subject: "Délai d'appel",
  };

  it("shows the unread count on the bell and explains each reminder", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/notifications": jsonResponse(200, { notifications: [notification], unread: 1 }),
      [`POST /api/notifications/${notification.id}/read`]: jsonResponse(204, null),
    });
    renderRoute("/notifications");
    expect(await screen.findByRole("link", { name: "Rappels : 1 non lu" })).toHaveAttribute(
      "href",
      "/notifications",
    );
    expect(await screen.findByText("Échéance dans deux jours")).toBeInTheDocument();
    expect(screen.getByText("Délai d'appel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Marquer comme lu : Délai d'appel" }));
    await waitFor(() => {
      expect(requests.some((r) => r.method === "POST")).toBe(true);
    });
  });
});
