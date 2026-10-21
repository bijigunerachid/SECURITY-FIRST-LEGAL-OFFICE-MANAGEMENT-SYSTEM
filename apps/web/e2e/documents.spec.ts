import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectRefusals,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

/**
 * Documents in a matter, end to end, against the fake malware scanner
 * started by the Playwright config (it flags MALWARE_MARKER). The real
 * ClamAV is tested in CI by the API's integration tests.
 */
test.describe.configure({ mode: "serial" });

/** Must match FAKE_MALWARE_MARKER in apps/api/src/test/fake-clamd.ts. */
const MALWARE_MARKER = "LEXORA-FAKE-MALWARE-TEST-MARKER";

function pdf(text: string): Buffer {
  const body = `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${text}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const shared = { matterUrl: "", apiBase: "" };

/**
 * Creates a client and a matter through the API, from inside the page (the
 * browser sends the Secure session cookie to 127.0.0.1; Playwright's own
 * request client does not over plain http).
 */
async function newMatter(page: Page, label: string): Promise<string> {
  await page.goto("/");
  return page.evaluate(async (name) => {
    const session = (await (await fetch("/api/auth/session")).json()) as { csrfToken: string };
    const post = async (path: string, body: unknown) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json() as Promise<Record<string, { id: string }>>;
    };
    const client = await post("/api/clients", { kind: "person", name: `Client documents ${name}` });
    const matter = await post("/api/matters", {
      clientId: client["client"]?.id,
      title: `Dossier documents ${name}`,
      area: "civil",
    });
    return matter["matter"]?.id ?? "";
  }, label);
}

const documentsRegion = (page: Page) => page.getByRole("region", { name: "Documents" });

test.describe("a lawyer's documents", () => {
  test.use({ storageState: storageState.lawyer });

  test("uploads, downloads the exact bytes, adds a version, and sees refusals explained", async ({
    page,
    consoleErrors,
  }, testInfo) => {
    const label = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const matterId = await newMatter(page, label);
    shared.matterUrl = `/matters/${matterId}`;
    shared.apiBase = `/api/matters/${matterId}/documents`;
    await page.goto(shared.matterUrl);
    const region = documentsRegion(page);
    await expect(region.getByText("Aucun document dans ce dossier.")).toBeVisible();

    // Upload.
    const original = pdf(`original ${label}`);
    await region.locator('input[type="file"]').first().setInputFiles({
      name: "Bail commercial.pdf",
      mimeType: "application/pdf",
      buffer: original,
    });
    await expect(region.getByText("« Bail commercial.pdf » a été ajouté.")).toBeVisible();
    await expect(region.getByText("Bail commercial.pdf", { exact: true })).toBeVisible();

    // Download: the same bytes, offered as an attachment with the right name.
    const downloading = page.waitForEvent("download");
    await region.getByRole("link", { name: "Télécharger Bail commercial.pdf" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("Bail commercial.pdf");
    expect(await readFile(await download.path())).toEqual(original);

    // A new version.
    const second = pdf(`second ${label}`);
    await region.locator("li").locator('input[type="file"]').first().setInputFiles({
      name: "Bail commercial v2.pdf",
      mimeType: "application/pdf",
      buffer: second,
    });
    await expect(region.getByText(/2 versions/)).toBeVisible();

    // Refusals: a file the scanner flags, and an executable named .pdf.
    await region
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "facture.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.concat([pdf("x"), Buffer.from(MALWARE_MARKER)]),
      });
    await expect(region.getByRole("alert")).toContainText("logiciel malveillant");
    await region
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "virement.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(300)]),
      });
    await expect(region.getByRole("alert")).toContainText("Fichier refusé");
    await expect(region.locator("li")).toHaveCount(1);
    // The two refusals above were answered 422 and 415, as intended.
    expectRefusals(consoleErrors, [422, 415]);

    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`documents-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // Version history.
    await region.getByRole("button", { name: "Voir les versions de Bail commercial.pdf" }).click();
    const history = page.getByRole("dialog", { name: "Versions de « Bail commercial.pdf »" });
    await expect(history.getByText("Version 1")).toBeVisible();
    await expectNoA11yViolations(page);
    await history.getByRole("button", { name: "Fermer" }).click();

    await switchToArabic(page);
    await expect(page.getByRole("region", { name: "الوثائق" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`documents-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe("a lawyer outside the team", () => {
  test.use({ storageState: storageState.colleague });

  test("cannot list or download the documents, even with the address", async ({ page }) => {
    await page.goto(shared.matterUrl);
    const status = await page.evaluate(async (path) => (await fetch(path)).status, shared.apiBase);
    expect(status).toBe(404);
    const download = await page.evaluate(
      async (path) => (await fetch(path)).status,
      `${shared.apiBase}/00000000-0000-4000-8000-000000000000/download`,
    );
    expect(download).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dossier introuvable" }),
    ).toBeVisible();
  });
});
