import type { BillingSettings, InvoiceDetail, InvoiceSummary, MatterDetail } from "@lexora/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { officeToday } from "@/features/matters/queries";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";
import { hundredthsToInput, parseHundredths } from "./queries";

const MATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVOICE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ME = "11111111-1111-4111-8111-111111111111";
const BASE = `/api/matters/${MATTER_ID}`;
const INVOICE = `${BASE}/invoices/${INVOICE_ID}`;

const permissions = {
  update: true,
  manageTeam: true,
  setRestricted: true,
  writeParties: true,
  updateClient: true,
  claimLead: false,
  writeDocuments: false,
  deleteDocuments: false,
  writeCalendar: false,
  deleteTasks: false,
  readBilling: true,
  draftInvoices: true,
  manageBilling: true,
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
    name: "Salma Berrada",
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
  members: [
    {
      userId: ME,
      displayName: "Fatima El Amrani",
      role: "lawyer",
      memberRole: "lead",
      active: true,
    },
  ],
  parties: [],
  permissions: { ...permissions, ...overrides },
});

const settings = (missing: BillingSettings["missing"] = []): BillingSettings => ({
  officeName: missing.includes("officeName") ? null : "Cabinet Alami",
  address: "12 avenue Hassan II, Rabat",
  phone: null,
  email: null,
  ice: "001234567000089",
  taxId: "12345678",
  professionalTaxId: null,
  barAssociation: "Rabat",
  bankName: "Banque Test",
  rib: "011780000012345678901234",
  vatRateBasisPoints: 2000,
  paymentTermDays: 30,
  invoiceNote: null,
  missing,
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const person = { id: ME, displayName: "Fatima El Amrani" };

function invoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: INVOICE_ID,
    matter: { id: MATTER_ID, reference: "2026-0007", title: "Succession Berrada" },
    kind: "invoice",
    status: "draft",
    number: null,
    issuedOn: null,
    dueOn: null,
    clientName: "Salma Berrada",
    totalCentimes: 1_235_000,
    balanceCentimes: 0,
    paymentState: null,
    overdue: false,
    createdAt: "2026-10-01T09:00:00.000Z",
    creditedInvoice: null,
    notes: null,
    feeVatRateBasisPoints: 2000,
    lines: [
      {
        kind: "fee",
        description: "Honoraires de consultation",
        quantityHundredths: 100,
        unitPriceCentimes: 1_000_000,
        vatRateBasisPoints: 2000,
        netCentimes: 1_000_000,
      },
      {
        kind: "disbursement",
        description: "Timbres fiscaux",
        quantityHundredths: 100,
        unitPriceCentimes: 35_000,
        vatRateBasisPoints: 0,
        netCentimes: 35_000,
      },
    ],
    vatBreakdown: [
      { rateBasisPoints: 2000, netCentimes: 1_000_000, vatCentimes: 200_000 },
      { rateBasisPoints: 0, netCentimes: 35_000, vatCentimes: 0 },
    ],
    subtotalCentimes: 1_035_000,
    vatCentimes: 200_000,
    creditedCentimes: 0,
    receivedCentimes: 0,
    seller: null,
    buyer: null,
    creditNotes: [],
    payments: [],
    createdBy: person,
    issuedBy: null,
    updatedAt: "2026-10-01T09:00:00.000Z",
    permissions: { edit: true, delete: true, issue: true, creditNote: false, recordPayment: false },
    ...overrides,
  };
}

const issued = (overrides: Partial<InvoiceDetail> = {}) =>
  invoice({
    status: "issued",
    number: "F-2026-0012",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-31",
    balanceCentimes: 1_235_000,
    paymentState: "unpaid",
    seller: {
      officeName: "Cabinet Alami",
      address: "12 avenue Hassan II, Rabat",
      phone: null,
      email: null,
      ice: "001234567000089",
      taxId: "12345678",
      professionalTaxId: null,
      barAssociation: "Rabat",
      bankName: "Banque Test",
      rib: "011780000012345678901234",
      invoiceNote: null,
    },
    buyer: { name: "Salma Berrada", kind: "person", identifier: "AB123456", address: null },
    issuedBy: person,
    permissions: {
      edit: false,
      delete: false,
      issue: false,
      creditNote: true,
      recordPayment: true,
    },
    ...overrides,
  });

/** The list form of an invoice (lists are strict: no detail fields). */
const summary = (d: InvoiceDetail): InvoiceSummary => ({
  id: d.id,
  matter: d.matter,
  kind: d.kind,
  status: d.status,
  number: d.number,
  issuedOn: d.issuedOn,
  dueOn: d.dueOn,
  clientName: d.clientName,
  totalCentimes: d.totalCentimes,
  balanceCentimes: d.balanceCentimes,
  paymentState: d.paymentState,
  overdue: d.overdue,
  createdAt: d.createdAt,
});

function invoiceApi(
  detail: InvoiceDetail,
  extra: Parameters<typeof mockApi>[0] = {},
  role = "lawyer" as const,
) {
  return mockApi({
    "GET /api/auth/session": signedIn({ role }),
    [`GET ${BASE}`]: jsonResponse(200, { matter: matter() }),
    [`GET ${INVOICE}`]: jsonResponse(200, { invoice: detail }),
    "GET /api/billing/settings": jsonResponse(200, { settings: settings() }),
    ...extra,
  });
}

describe("amount input", () => {
  it("reads dirhams with a comma or a point and spaces, into whole centimes", () => {
    expect(parseHundredths("1 500,50")).toBe(150_050);
    expect(parseHundredths("1500.5")).toBe(150_050);
    // Intl separates thousands with a narrow no-break space in some locales.
    expect(parseHundredths(`1${String.fromCharCode(0x202f)}500`)).toBe(150_000);
    expect(parseHundredths("0,01")).toBe(1);
    expect(parseHundredths("12")).toBe(1200);
    // As fr-MA writes amounts: points group thousands when a comma marks the decimals.
    expect(parseHundredths("1.500,50")).toBe(150_050);
    expect(parseHundredths("1.234.567,8")).toBe(123_456_780);
    for (const bad of ["", "1,505", "-3", "1.500", "1.50.0,5", "abc", "1e3", "1,2,3"]) {
      expect(parseHundredths(bad), bad).toBeNull();
    }
    expect(hundredthsToInput(150_050)).toBe("1500,50");
    expect(hundredthsToInput(150)).toBe("1,50");
    expect(hundredthsToInput(100)).toBe("1");
  });
});

describe("matter billing section", () => {
  it("shows fee agreements and invoices, and opens a new draft", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      [`GET ${BASE}`]: jsonResponse(200, { matter: matter() }),
      [`GET ${BASE}/fee-agreements`]: jsonResponse(200, {
        feeAgreements: [
          {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            matterId: MATTER_ID,
            kind: "hourly",
            title: "Convention 2026",
            amountCentimes: null,
            hourlyRateCentimes: 80_000,
            signedOn: "2026-01-15",
            terms: null,
            endedOn: null,
            createdBy: person,
            createdAt: "2026-01-15T09:00:00.000Z",
            updatedAt: "2026-01-15T09:00:00.000Z",
          },
        ],
      }),
      [`GET ${BASE}/invoices`]: jsonResponse(200, { invoices: [summary(issued())] }),
      [`POST ${BASE}/invoices`]: jsonResponse(201, {
        invoice: invoice({ lines: [], totalCentimes: 0 }),
      }),
      [`GET ${INVOICE}`]: jsonResponse(200, { invoice: invoice({ lines: [], totalCentimes: 0 }) }),
      "GET /api/billing/settings": jsonResponse(200, { settings: settings() }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    const section = (
      await screen.findByRole("heading", { name: "Honoraires et facturation" })
    ).closest("section");
    if (!section) throw new Error("no billing section");
    expect(await within(section).findByText("Convention 2026")).toBeInTheDocument();
    expect(within(section).getByText(/800,00.*de l'heure/)).toBeInTheDocument();
    expect(await within(section).findByText("F-2026-0012")).toBeInTheDocument();
    expect(within(section).getByText("Non payée")).toBeInTheDocument();

    await userEvent.click(within(section).getByRole("button", { name: "Nouvelle facture" }));
    expect(
      await screen.findByRole("heading", { name: /Brouillon de facture/ }),
    ).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ lines: [] });
  });

  it("is absent without billing access (break-glass)", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn({ role: "admin" }),
      [`GET ${BASE}`]: jsonResponse(200, {
        matter: matter({ readBilling: false, draftInvoices: false, manageBilling: false }),
      }),
    });
    renderRoute(`/matters/${MATTER_ID}`);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Honoraires et facturation" }),
    ).not.toBeInTheDocument();
    expect(
      requests.some((r) => r.path.includes("invoices") || r.path.includes("fee-agreements")),
    ).toBe(false);
  });
});

describe("draft invoice", () => {
  it("sends amounts as whole centimes and shows the totals the server computed", async () => {
    const empty = invoice({
      lines: [],
      totalCentimes: 0,
      subtotalCentimes: 0,
      vatCentimes: 0,
      vatBreakdown: [],
    });
    const { requests } = invoiceApi(empty, {
      // Before the save, then as reloaded after it.
      [`GET ${INVOICE}`]: [
        jsonResponse(200, { invoice: empty }),
        jsonResponse(200, { invoice: invoice() }),
      ],
      [`PATCH ${INVOICE}`]: jsonResponse(200, { invoice: invoice() }),
    });
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    await userEvent.type(await screen.findByLabelText("Désignation"), "Honoraires de consultation");
    const quantity = screen.getByLabelText("Quantité");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "1,5");
    await userEvent.type(screen.getByLabelText("Prix unitaire HT"), "1 500,50");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));

    await waitFor(() => {
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
        notes: null,
        lines: [
          {
            kind: "fee",
            description: "Honoraires de consultation",
            quantityHundredths: 150,
            unitPriceCentimes: 150_050,
          },
        ],
      });
    });
    expect(
      await screen.findByText("Brouillon enregistré. Les totaux ont été recalculés."),
    ).toBeInTheDocument();
    const document = screen.getByRole("article", { name: "Facture" });
    expect(await within(document).findByText(/12\.350,00/)).toBeInTheDocument();
  });

  it("flags amounts it cannot read instead of sending them", async () => {
    const { requests } = invoiceApi(invoice());
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    const [price] = await screen.findAllByLabelText(/Prix unitaire HT/, { selector: "input" });
    if (!price) throw new Error("no price input");
    await userEvent.clear(price);
    await userEvent.type(price, "12,345");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    expect(await screen.findByText("Valeur manquante ou invalide.")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("cannot be issued until the office details are complete", async () => {
    invoiceApi(invoice(), {
      "GET /api/billing/settings": jsonResponse(200, { settings: settings(["officeName"]) }),
    });
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    expect(await screen.findByText("Coordonnées du cabinet incomplètes")).toBeInTheDocument();
    expect(screen.getByText(/Nom du cabinet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Émettre la facture" })).toBeDisabled();
  });

  it("is issued by a lawyer after confirming", async () => {
    const { requests } = invoiceApi(invoice(), {
      [`POST ${INVOICE}/issue`]: jsonResponse(200, { invoice: issued() }),
    });
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Émettre la facture" }));
    const dialog = await screen.findByRole("dialog", { name: "Émettre ce document ?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuer" }));
    await waitFor(() => {
      expect(requests.some((r) => r.method === "POST" && r.path === `${INVOICE}/issue`)).toBe(true);
    });
  });

  it("tells an assistant that a lawyer issues it", async () => {
    invoiceApi(
      invoice({
        permissions: {
          edit: true,
          delete: true,
          issue: false,
          creditNote: false,
          recordPayment: false,
        },
      }),
      {},
      "assistant" as "lawyer",
    );
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    expect(
      await screen.findByText("Un avocat de l'équipe émettra ce brouillon."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Émettre la facture" })).not.toBeInTheDocument();
  });
});

describe("issued invoice", () => {
  it("shows the frozen office and client details, numbers kept left-to-right in Arabic", async () => {
    invoiceApi(issued());
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`, "ar");
    const document = await screen.findByRole("article", { name: "فاتورة" });
    expect(within(document).getByText("F-2026-0012")).toHaveAttribute("dir", "ltr");
    expect(within(document).getByText(/001234567000089/)).toBeInTheDocument();
    // French addresses inside Arabic text keep their own direction ("12 avenue…", not "avenue… 12").
    expect(within(document).getByText("12 avenue Hassan II, Rabat")).toHaveAttribute("dir", "auto");
    expect(within(document).getByText(/AB123456/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "طباعة" })).toBeInTheDocument();
  });

  it("records a payment, never more than is due", async () => {
    const { requests } = invoiceApi(issued(), {
      [`POST ${INVOICE}/payments`]: jsonResponse(201, {
        invoice: issued({ paymentState: "partial" }),
      }),
    });
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Enregistrer un règlement" }));
    const dialog = await screen.findByRole("dialog", { name: "Enregistrer un règlement" });
    const amount = within(dialog).getByLabelText("Montant");
    expect(amount).toHaveValue("12350");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12350,01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/payments"))).toBe(false);

    await userEvent.clear(amount);
    await userEvent.type(amount, "5000");
    await userEvent.selectOptions(within(dialog).getByLabelText("Mode de règlement"), "cheque");
    await userEvent.type(within(dialog).getByLabelText(/Référence/), "CHQ 0042");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(
        requests.find((r) => r.method === "POST" && r.path.endsWith("/payments"))?.body,
      ).toEqual({
        kind: "payment",
        receivedOn: officeToday(),
        amountCentimes: 500_000,
        method: "cheque",
        reference: "CHQ 0042",
        notes: null,
      });
    });
  });

  it("voids a payment only with a reason, and explains when the refund must go first", async () => {
    const payment = {
      id: "99999999-9999-4999-8999-999999999999",
      kind: "payment" as const,
      receivedOn: "2026-10-02",
      amountCentimes: 500_000,
      method: "cheque" as const,
      reference: "CHQ 0042",
      notes: null,
      recordedBy: person,
      createdAt: "2026-10-02T09:00:00.000Z",
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    };
    const { requests } = invoiceApi(issued({ payments: [payment], paymentState: "partial" }), {
      [`POST ${INVOICE}/payments/${payment.id}/void`]: apiError(409, "conflict"),
    });
    renderRoute(`/matters/${MATTER_ID}/invoices/${INVOICE_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: /Annuler le règlement de/ }));
    const dialog = await screen.findByRole("dialog", { name: "Annuler ce règlement ?" });
    await userEvent.type(within(dialog).getByLabelText("Raison"), "abc");
    await userEvent.click(within(dialog).getByRole("button", { name: "Annuler le règlement" }));
    expect(requests.some((r) => r.path.endsWith("/void"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Raison"), " – chèque rejeté");
    await userEvent.click(within(dialog).getByRole("button", { name: "Annuler le règlement" }));
    expect(
      await within(dialog).findByText("Annulez d'abord le remboursement lié à ce règlement."),
    ).toBeInTheDocument();
    expect(requests.find((r) => r.path.endsWith("/void"))?.body).toEqual({
      reason: "abc – chèque rejeté",
    });
  });
});

describe("invoices page", () => {
  const list = {
    invoices: [
      summary(issued({ overdue: true, balanceCentimes: 735_000, paymentState: "partial" })),
    ],
    page: 1,
    hasMore: false,
  };

  it("lists the person's invoices with what is left to pay, and offers the export to lawyers", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/invoices?view=all&page=1": jsonResponse(200, list),
    });
    renderRoute("/invoices");
    expect(await screen.findByText("F-2026-0012")).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /F-2026-0012/ });
    expect(within(row).getByText("En retard")).toBeInTheDocument();
    expect(within(row).getByText(/Reste 7\.350,00/)).toBeInTheDocument();
    const year = officeToday().slice(0, 4);
    expect(screen.getByRole("link", { name: "Télécharger (CSV)" })).toHaveAttribute(
      "href",
      `/api/invoices/export?from=${year}-01-01&to=${officeToday()}`,
    );
  });

  it("does not offer the export to assistants", async () => {
    mockApi({
      "GET /api/auth/session": signedIn({ role: "assistant" }),
      "GET /api/invoices?view=all&page=1": jsonResponse(200, list),
    });
    renderRoute("/invoices");
    expect(await screen.findByText("F-2026-0012")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Télécharger (CSV)" })).not.toBeInTheDocument();
  });
});

describe("administrator billing page", () => {
  it("asks for the password again before saving the office details", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn({ role: "admin", mfaEnabled: false }),
      "GET /api/billing/settings": jsonResponse(200, { settings: settings(["officeName"]) }),
      [`GET /api/billing/summary?year=${officeToday().slice(0, 4)}`]: jsonResponse(200, {
        summary: {
          year: Number(officeToday().slice(0, 4)),
          months: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            invoiceCount: i === 9 ? 2 : 0,
            invoicedCentimes: i === 9 ? 2_470_000 : 0,
            creditedCentimes: 0,
            receivedCentimes: 0,
          })),
          outstandingCentimes: 2_470_000,
          overdueCount: 1,
        },
      }),
      "PATCH /api/billing/settings": [
        apiError(403, "reauthentication_required"),
        jsonResponse(200, { settings: settings() }),
      ],
      "POST /api/auth/reauth": jsonResponse(204, null),
    });
    renderRoute("/admin/billing");
    expect(
      await screen.findByText("Les factures ne peuvent pas encore être émises"),
    ).toBeInTheDocument();
    expect(await screen.findByText(/24\.700,00/, { selector: "dd" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nom du cabinet"), "Cabinet Alami");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByText("Modifications enregistrées.")).toBeInTheDocument();
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]?.body).toMatchObject({
      officeName: "Cabinet Alami",
      vatRateBasisPoints: 2000,
    });
  });
});
