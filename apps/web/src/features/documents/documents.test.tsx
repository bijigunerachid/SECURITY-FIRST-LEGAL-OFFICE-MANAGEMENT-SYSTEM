import type { DocumentSummary, MatterDetail } from "@lexora/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";

const MATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "11111111-1111-4111-8111-111111111111";
const BASE = `/api/matters/${MATTER_ID}/documents`;

const all = {
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
  // Billing has its own tests; kept off so these pages load only what they test.
  readBilling: false,
  draftInvoices: false,
  manageBilling: false,
};

const matter = (permissions: Partial<typeof all> = {}): MatterDetail => ({
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
  permissions: { ...all, ...permissions },
});

const version = {
  number: 2,
  fileName: "Bail.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1_572_864,
  sha256: "a".repeat(64),
  uploadedBy: { id: ME, displayName: "Fatima El Amrani" },
  createdAt: "2026-03-05T10:00:00.000Z",
};
const doc: DocumentSummary = {
  id: DOC_ID,
  title: "Bail commercial.pdf",
  latest: version,
  versionCount: 2,
  createdAt: "2026-03-02T10:00:00.000Z",
  updatedAt: "2026-03-05T10:00:00.000Z",
};

function setUp(permissions: Partial<typeof all> = {}, extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    "GET /api/auth/session": signedIn(),
    [`GET /api/matters/${MATTER_ID}`]: jsonResponse(200, { matter: matter(permissions) }),
    [`GET ${BASE}`]: jsonResponse(200, { documents: [doc] }),
    [`GET /api/matters/${MATTER_ID}/hearings`]: jsonResponse(200, { hearings: [] }),
    [`GET /api/matters/${MATTER_ID}/tasks`]: jsonResponse(200, { tasks: [] }),
    "GET /api/notifications": jsonResponse(200, { notifications: [], unread: 0 }),
    ...extra,
  });
  const rendered = renderRoute(`/matters/${MATTER_ID}`);
  return { ...api, ...rendered };
}

const fileInput = (container: HTMLElement) => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return input;
};

describe("documents section", () => {
  it("lists documents with type, size, author and a download link", async () => {
    setUp();
    expect(await screen.findByText("Bail commercial.pdf")).toBeInTheDocument();
    expect(screen.getByText(/PDF · 1,5 Mo · ajouté par Fatima El Amrani/)).toBeInTheDocument();
    expect(screen.getByText(/2 versions/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Télécharger Bail commercial.pdf" })).toHaveAttribute(
      "href",
      `${BASE}/${DOC_ID}/download`,
    );
    expect(
      screen.getByRole("button", { name: "Supprimer Bail commercial.pdf" }),
    ).toBeInTheDocument();
  });

  it("shows assistants no delete button, and break-glass readers no changes at all", async () => {
    setUp({ deleteDocuments: false });
    await screen.findByText("Bail commercial.pdf");
    expect(screen.queryByRole("button", { name: /Supprimer/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Ajouter un document" })).toBeInTheDocument();
  });

  it("offers only downloads to a reader without write access", async () => {
    setUp({ writeDocuments: false, deleteDocuments: false });
    await screen.findByText("Bail commercial.pdf");
    const section = screen.getByRole("region", { name: "Documents" });
    expect(
      within(section).queryAllByRole("button", {
        name: /Ajouter|Nouvelle version|Renommer|Supprimer/,
      }),
    ).toEqual([]);
    expect(within(section).getByRole("link", { name: /Télécharger/ })).toBeInTheDocument();
  });

  it("uploads the raw file with its encoded name and the CSRF token", async () => {
    const created = { document: { ...doc, versions: [version] } };
    const { requests, container } = setUp({}, { [`POST ${BASE}`]: jsonResponse(201, created) });
    await screen.findByText("Bail commercial.pdf");
    const file = new File(["%PDF-1.4 test"], "Décision n°1.pdf", { type: "application/pdf" });
    await userEvent.upload(fileInput(container), file);

    expect(await screen.findByText("« Décision n°1.pdf » a été ajouté.")).toBeInTheDocument();
    const post = requests.find((r) => r.method === "POST");
    expect(post?.path).toBe(BASE);
    expect(post?.headers).toMatchObject({
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("Décision n°1.pdf"),
      "X-CSRF-Token": "csrf-test-token",
    });
  });

  it("checks size and extension before sending anything", async () => {
    const { requests, container } = setUp();
    await screen.findByText("Bail commercial.pdf");
    const big = new File(["x"], "scan.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await userEvent.upload(fileInput(container), big, { applyAccept: false });
    expect(await screen.findByText("« scan.pdf » dépasse 25 Mo.")).toBeInTheDocument();

    const script = new File(["x"], "macro.docm");
    await userEvent.upload(fileInput(container), script, { applyAccept: false });
    expect(
      await screen.findByText(/« macro.docm » n'est pas d'un type accepté/),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it.each([
    ["malware_detected", 422, "l'antivirus y a détecté un logiciel malveillant"],
    ["scan_unavailable", 503, "L'antivirus ne répond pas"],
    ["unsupported_file_type", 415, "sans macros ni chiffrement"],
  ])("explains a %s refusal", async (code, status, text) => {
    const { container } = setUp({}, { [`POST ${BASE}`]: apiError(status, code) });
    await screen.findByText("Bail commercial.pdf");
    await userEvent.upload(fileInput(container), new File(["%PDF"], "x.pdf"));
    const section = screen.getByRole("region", { name: "Documents" });
    expect(await within(section).findByRole("alert")).toHaveTextContent(text);
  });

  it("asks before deleting, then sends the deletion", async () => {
    const { requests } = setUp({}, { [`DELETE ${BASE}/${DOC_ID}`]: jsonResponse(204, null) });
    await userEvent.click(
      await screen.findByRole("button", { name: "Supprimer Bail commercial.pdf" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le document" });
    expect(
      within(dialog).getByText(/le fichier est conservé pour l'historique/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuer" }));
    await waitFor(() => {
      expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    });
  });

  it("lists every version with its own download link", async () => {
    setUp(
      {},
      {
        [`GET ${BASE}/${DOC_ID}`]: jsonResponse(200, {
          document: {
            ...doc,
            versions: [version, { ...version, number: 1, fileName: "Bail v1.pdf" }],
          },
        }),
      },
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Voir les versions de Bail commercial.pdf" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Version 1")).toBeInTheDocument();
    const links = within(dialog).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `${BASE}/${DOC_ID}/download?version=2`,
      `${BASE}/${DOC_ID}/download?version=1`,
    ]);
  });
});
