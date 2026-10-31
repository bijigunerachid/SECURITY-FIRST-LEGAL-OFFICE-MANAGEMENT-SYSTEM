import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { adminFor, storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

/**
 * The audit-log viewer, security alerts and the matter history, through the
 * real API, CLI and worker.
 */
test.describe.configure({ mode: "serial" });

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The backup job's report and one worker run, as the server would do them. */
function reportFailedBackupAndScan(): void {
  execSync("npm run admin:e2e -w @lexora/api -- backup-report --status failed --detail e2e", {
    cwd: root,
    stdio: "ignore",
  });
  execSync("npm run worker:e2e -w @lexora/api -- --once", { cwd: root, stdio: "ignore" });
}

async function newMatter(page: Page, label: string): Promise<string> {
  await page.goto("/");
  return page.evaluate(async (name) => {
    const session = (await (await fetch("/api/auth/session")).json()) as { csrfToken: string };
    const call = async (path: string, body: unknown) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path}: ${String(res.status)}`);
      return res.json() as Promise<Record<string, { id: string }>>;
    };
    const client = await call("/api/clients", {
      kind: "person",
      name: `Client historique ${name}`,
    });
    const matter = await call("/api/matters", {
      clientId: client["client"]?.id,
      title: `Dossier historique ${name}`,
      area: "civil",
    });
    return matter["matter"]?.id ?? "";
  }, label);
}

test.describe("an administrator", () => {
  test("handles a security alert raised by the worker", async ({ browser }, testInfo) => {
    reportFailedBackupAndScan();
    const context = await browser.newContext({
      storageState: adminFor(testInfo.project.name).state,
    });
    const page = await context.newPage();
    await page.goto("/admin/alerts");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: /^Alertes \(à traiter : \d+\)$/ })).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: "Sauvegarde en échec" }).first();
    await expect(item).toBeVisible();
    await expect(item.getByText("Critique")).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`alerts-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // Handling happens once (desktop), so two browsers never race for the same alert.
    if (testInfo.project.name === "desktop") {
      await item.getByRole("button", { name: /Prendre en compte/ }).click();
      // The list reloads: follow the alert that is now acknowledged.
      const acknowledged = page
        .getByRole("listitem")
        .filter({ hasText: "Sauvegarde en échec" })
        .filter({ hasText: "Prise en compte par" })
        .first();
      await expect(acknowledged).toBeVisible();
      await acknowledged.getByRole("button", { name: /Résoudre/ }).click();
      const dialog = page.getByRole("dialog", { name: "Résoudre l'alerte" });
      await dialog
        .getByLabel("Ce qui a été fait")
        .fill("Disque de sauvegarde remplacé, nouvelle sauvegarde lancée");
      await dialog.getByRole("button", { name: "Résoudre" }).click();
      await expect(dialog).toBeHidden();
      await page.getByLabel("Afficher").selectOption("resolved");
      await expect(page.getByText(/Disque de sauvegarde remplacé/).first()).toBeVisible();
    }
    await context.close();
  });

  test("reads the audit log, filters it and verifies its integrity", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      storageState: adminFor(testInfo.project.name).state,
    });
    const page = await context.newPage();
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Journal d'audit" })).toBeVisible();
    await page.getByLabel("Type d'action").selectOption("auth.");
    await page.getByRole("button", { name: "Filtrer" }).click();
    await expect(page).toHaveURL(/action=auth\./);
    await expect(page.getByText("Connexion", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Vérifier maintenant" }).click();
    await expect(page.getByText("Journal intact")).toBeVisible({ timeout: 15_000 });
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`audit-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await switchToArabic(page);
    await expect(page.getByRole("heading", { level: 1, name: "سجل التدقيق" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`audit-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Français" }).click();

    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Ce que chaque rôle peut faire" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`users-roles-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await context.close();
  });
});

test.describe("a lead lawyer", () => {
  test.use({ storageState: storageState.lawyer });

  test("sees the history of their matter", async ({ page }, testInfo) => {
    const label = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const matterId = await newMatter(page, label);
    await page.goto(`/matters/${matterId}`);
    const history = page.getByRole("region", { name: "Historique du dossier" });
    await history.getByRole("button", { name: "Afficher l'historique" }).click();
    await expect(history.getByText("Dossier ouvert")).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
