import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { accounts, adminFor, storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

/**
 * Fees, invoices, payments and credit notes, through the real API and
 * database. The e2e seed fills in synthetic office details, so invoices can
 * be issued.
 */
test.describe.configure({ mode: "serial" });

const shared = { matterId: "", invoiceUrl: "", label: "", number: "" };

/** Creates a matter with the assistant on its team, from inside the page (Secure cookie on http). */
async function newMatter(page: Page, label: string, assistantName: string): Promise<string> {
  await page.goto("/");
  return page.evaluate(
    async ({ name, assistant }) => {
      const session = (await (await fetch("/api/auth/session")).json()) as { csrfToken: string };
      const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)}`);
        return res.status === 204 ? {} : (res.json() as Promise<Record<string, unknown>>);
      };
      const client = (await call("POST", "/api/clients", {
        kind: "company",
        name: `Atlas Facturation ${name}`,
        identifier: "002233445000067",
        address: "Bd Zerktouni, Casablanca",
      })) as { client: { id: string } };
      const matter = (await call("POST", "/api/matters", {
        clientId: client.client.id,
        title: `Dossier facturation ${name}`,
        area: "commercial",
      })) as { matter: { id: string } };
      const candidates = (await (
        await fetch(`/api/matters/${matter.matter.id}/candidates`)
      ).json()) as { users: { id: string; displayName: string }[] };
      const member = candidates.users.find((u) => u.displayName === assistant);
      if (!member) throw new Error("assistant not found");
      await call("POST", `/api/matters/${matter.matter.id}/members`, { userId: member.id });
      return matter.matter.id;
    },
    { name: label, assistant: assistantName },
  );
}

test.describe("a lawyer's billing", () => {
  test.use({ storageState: storageState.lawyer });

  // Numbers in headings sit in a left-to-right isolate (one invisible mark before them): ".?".
  test("records a fee agreement, drafts and issues an invoice", async ({ page }, testInfo) => {
    shared.label = `${testInfo.project.name} ${Date.now().toString(36)}`;
    shared.matterId = await newMatter(page, shared.label, accounts.assistant.name);
    await page.goto(`/matters/${shared.matterId}`);

    const billing = page.getByRole("region", { name: "Honoraires et facturation" });
    await billing.getByRole("button", { name: "Ajouter une convention" }).click();
    const agreement = page.getByRole("dialog", { name: "Nouvelle convention d'honoraires" });
    await agreement.getByLabel("Intitulé").fill(`Forfait ${shared.label}`);
    await agreement.getByLabel("Montant forfaitaire").fill("15 000");
    await agreement.getByRole("button", { name: "Enregistrer" }).click();
    await expect(agreement).toBeHidden();
    await expect(billing.getByText(`Forfait ${shared.label}`)).toBeVisible();

    await billing.getByRole("button", { name: "Nouvelle facture" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Brouillon de facture/ }),
    ).toBeVisible();
    shared.invoiceUrl = new URL(page.url()).pathname;

    const editor = page.getByRole("region", { name: "Lignes du brouillon" });
    await editor.getByLabel("Désignation").fill("Honoraires de consultation");
    await editor.getByLabel("Quantité").fill("1,5");
    await editor.getByLabel("Prix unitaire HT").fill("2 000");
    await editor.getByRole("button", { name: "Ajouter des débours" }).click();
    await editor.getByLabel("Désignation").nth(1).fill("Frais de greffe");
    await editor.getByLabel("Prix unitaire HT").nth(1).fill("350,00");
    await editor.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await expect(editor.getByText("Brouillon enregistré.", { exact: false })).toBeVisible();

    // 1,5 × 2 000,00 = 3 000,00 HT, VAT 20 % = 600,00, plus 350,00 of disbursements.
    const document = page.getByRole("article", { name: "Facture" });
    await expect(document.getByText(/3\.950,00/)).toBeVisible();

    await page.getByRole("button", { name: "Émettre la facture" }).click();
    const confirm = page.getByRole("dialog", { name: "Émettre ce document ?" });
    await confirm.getByRole("button", { name: "Continuer" }).click();
    await expect(
      // The number sits in a left-to-right isolate: one invisible mark before it.
      page.getByRole("heading", { level: 1, name: /Facture .?F-\d{4}-\d{4}/ }),
    ).toBeVisible();
    shared.number = (await document.locator("bdi").first().innerText()).trim();
    expect(shared.number).toMatch(/^F-\d{4}-\d{4,}$/);
    await expect(page.getByText("Non payée")).toBeVisible();
    await expect(document.getByText("Cabinet de démonstration Lexora")).toBeVisible();
    await expect(editor).toBeHidden();

    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`invoice-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
    // The printed page: only the invoice itself.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "Imprimer" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeHidden();
    await page.screenshot({
      path: testInfo.outputPath(`invoice-print-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
  });

  test("records a partial payment, then credits the disbursement", async ({ page }, testInfo) => {
    await page.goto(shared.invoiceUrl);
    await page.getByRole("button", { name: "Enregistrer un règlement" }).click();
    const dialog = page.getByRole("dialog", { name: "Enregistrer un règlement" });
    await dialog.getByLabel("Montant").fill("1000");
    await dialog.getByLabel("Mode de règlement").selectOption("cheque");
    await dialog.getByLabel(/Référence/).fill("CHQ 0042");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Payée en partie")).toBeVisible();
    await expect(page.getByText("CHQ 0042")).toBeVisible();

    await page.getByRole("button", { name: "Créer un avoir" }).click();
    await page
      .getByRole("dialog", { name: "Créer un avoir ?" })
      .getByRole("button", { name: "Continuer" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: /Brouillon d'avoir/ })).toBeVisible();
    const editor = page.getByRole("region", { name: "Lignes de l'avoir" });
    // Keep only the disbursement.
    await editor.getByRole("button", { name: "Retirer la ligne 1" }).click();
    await editor.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await expect(editor.getByText("Brouillon enregistré.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Émettre l'avoir" }).click();
    await page
      .getByRole("dialog", { name: "Émettre ce document ?" })
      .getByRole("button", { name: "Continuer" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Avoir .?AV-\d{4}-\d{4}/ }),
    ).toBeVisible();

    await page.goto(shared.invoiceUrl);
    const document = page.getByRole("article", { name: "Facture" });
    // 3 950,00 − 350,00 credited − 1 000,00 received = 2 600,00.
    await expect(document.getByText(/2\.600,00/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Avoirs sur cette facture" })).toBeVisible();

    await switchToArabic(page);
    await expect(page.getByRole("article", { name: "فاتورة" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`invoice-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Français" }).click();
  });

  test("finds it in the invoice list and exports the sales journal", async ({ page }, testInfo) => {
    await page.goto("/invoices");
    await page.getByLabel("Afficher").selectOption("outstanding");
    const row = page.getByRole("link", { name: new RegExp(shared.number) });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Reste 2\.600,00/)).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`invoices-${testInfo.project.name}.png`),
      fullPage: true,
    });

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Télécharger (CSV)" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^factures-\d{4}-01-01-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await file.path(), "utf8");
    expect(csv).toContain(`Facture;${shared.number};`);
    expect(csv).toContain(`;${shared.number};`);
    expect(csv).toMatch(/Avoir;AV-\d{4}-\d{4};/);
  });
});

test.describe("an assistant's billing", () => {
  test.use({ storageState: storageState.assistant });

  test("prepares a draft but leaves issuing to a lawyer", async ({ page }) => {
    await page.goto(`/matters/${shared.matterId}`);
    const billing = page.getByRole("region", { name: "Honoraires et facturation" });
    await expect(billing.getByRole("button", { name: "Ajouter une convention" })).toHaveCount(0);
    await billing.getByRole("button", { name: "Nouvelle facture" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Brouillon de facture/ }),
    ).toBeVisible();
    await expect(page.getByText("Un avocat de l'équipe émettra ce brouillon.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Émettre la facture" })).toHaveCount(0);

    await page.goto(shared.invoiceUrl);
    await expect(page.getByRole("button", { name: "Enregistrer un règlement" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Créer un avoir" })).toHaveCount(0);
  });
});

test.describe("an administrator's billing page", () => {
  test("shows the office details and monthly totals, without client names", async ({
    browser,
  }, testInfo) => {
    const { state } = adminFor(testInfo.project.name);
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    await page.goto("/admin/billing");
    await expect(page.getByLabel("Nom du cabinet")).toHaveValue("Cabinet de démonstration Lexora");
    const totals = page.getByRole("region", { name: "Totaux par mois" });
    await expect(totals.getByRole("table")).toBeVisible();
    await expect(page.getByText(/Atlas Facturation/)).toHaveCount(0);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`billing-admin-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await context.close();
  });
});
