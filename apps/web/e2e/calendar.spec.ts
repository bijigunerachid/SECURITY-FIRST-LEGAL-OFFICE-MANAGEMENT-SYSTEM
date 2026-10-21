import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { accounts, storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

/**
 * Hearings, deadlines and tasks on a matter, the agenda, and reminders
 * produced by the real worker command (run once, as an operator would).
 */
test.describe.configure({ mode: "serial" });

const root = fileURLToPath(new URL("../../..", import.meta.url));
const shared = { matterId: "", label: "" };

/** Office calendar day `days` from today (Africa/Casablanca). */
function officeDay(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
        kind: "person",
        name: `Client agenda ${name}`,
      })) as {
        client: { id: string };
      };
      const matter = (await call("POST", "/api/matters", {
        clientId: client.client.id,
        title: `Dossier agenda ${name}`,
        area: "civil",
      })) as { matter: { id: string } };
      const candidates = (await (
        await fetch(`/api/matters/${matter.matter.id}/candidates`)
      ).json()) as {
        users: { id: string; displayName: string }[];
      };
      const nadia = candidates.users.find((u) => u.displayName === assistant);
      if (!nadia) throw new Error("assistant not found");
      await call("POST", `/api/matters/${matter.matter.id}/members`, { userId: nadia.id });
      return matter.matter.id;
    },
    { name: label, assistant: assistantName },
  );
}

/** Runs every periodic task once with the real worker; repeats if another run held the lease. */
function runWorker(): void {
  execSync("npm run worker:e2e -w @lexora/api -- --once", { cwd: root, stdio: "ignore" });
}

test.describe("a lawyer's calendar", () => {
  test.use({ storageState: storageState.lawyer });

  test("adds a hearing, a deadline and a task for the assistant", async ({ page }, testInfo) => {
    shared.label = `${testInfo.project.name} ${Date.now().toString(36)}`;
    shared.matterId = await newMatter(page, shared.label, accounts.assistant.name);
    await page.goto(`/matters/${shared.matterId}`);

    const hearings = page.getByRole("region", { name: "Audiences" });
    await hearings.getByRole("button", { name: "Ajouter une audience" }).click();
    const hearingDialog = page.getByRole("dialog", { name: "Nouvelle audience" });
    await hearingDialog.getByLabel("Date et heure (heure du Maroc)").fill(`${officeDay(3)}T09:30`);
    await hearingDialog.getByLabel("Objet").fill(`Plaidoirie ${shared.label}`);
    await hearingDialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(hearingDialog).toBeHidden();
    await expect(hearings.getByText(`Plaidoirie ${shared.label}`)).toBeVisible();
    await expect(hearings.getByText(/09:30/)).toBeVisible();

    const tasks = page.getByRole("region", { name: "Échéances et tâches" });
    await tasks.getByRole("button", { name: "Ajouter" }).click();
    let dialog = page.getByRole("dialog", { name: "Nouvelle échéance ou tâche" });
    await dialog.getByLabel("Intitulé").fill(`Délai d'appel ${shared.label}`);
    await dialog.getByLabel("Date").fill(officeDay(1));
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toBeHidden();

    await tasks.getByRole("button", { name: "Ajouter" }).click();
    dialog = page.getByRole("dialog", { name: "Nouvelle échéance ou tâche" });
    await dialog.getByLabel("Type").selectOption("task");
    await dialog.getByLabel("Intitulé").fill(`Copier les pièces ${shared.label}`);
    await dialog.getByLabel("Attribuée à").selectOption({ label: accounts.assistant.name });
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toBeHidden();
    await expect(tasks.getByText(`Attribuée à ${accounts.assistant.name}`)).toBeVisible();

    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await hearings.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`calendar-matter-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test("sees them in the agenda, and gets reminders from the worker", async ({
    page,
  }, testInfo) => {
    await page.goto("/agenda");
    await expect(page.getByText(`Audience — Plaidoirie ${shared.label}`)).toBeVisible();
    await expect(page.getByText(`Délai d'appel ${shared.label}`)).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`agenda-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // The hearing is 3 days away ("in a week" stage); the deadline is tomorrow ("in two days").
    await expect
      .poll(
        async () => {
          runWorker();
          await page.goto("/notifications");
          // Wait for the list (or its empty message) before counting.
          await expect(page.getByText("Chargement…")).toHaveCount(0);
          return page.getByText(`Délai d'appel ${shared.label}`).count();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBeGreaterThan(0);
    const item = page.getByRole("listitem").filter({ hasText: `Délai d'appel ${shared.label}` });
    await expect(item.getByText("Échéance dans deux jours")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Rappels : \d+ non lus?$/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`notifications-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await switchToArabic(page);
    await expect(page.getByRole("heading", { level: 1, name: "التذكيرات" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`notifications-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe("the assistant", () => {
  test.use({ storageState: storageState.assistant });

  test("is told about the task given to them, and cannot delete it", async ({ page }) => {
    await page.goto("/notifications");
    const item = page
      .getByRole("listitem")
      .filter({ hasText: `Copier les pièces ${shared.label}` });
    await expect(item.getByText("Tâche qui vous est attribuée")).toBeVisible();
    await item.getByRole("button", { name: /Marquer comme lu/ }).click();
    await expect(item.getByText("Non lu")).toHaveCount(0);

    await page.goto(`/matters/${shared.matterId}`);
    const tasks = page.getByRole("region", { name: "Échéances et tâches" });
    await expect(tasks.getByText(`Copier les pièces ${shared.label}`)).toBeVisible();
    await expect(tasks.getByRole("button", { name: /Supprimer/ })).toHaveCount(0);
    // The box shows what the server saved, so it ticks once the change is stored.
    const done = tasks.getByRole("checkbox", {
      name: `« Copier les pièces ${shared.label} » est fait(e)`,
    });
    await done.click();
    await expect(done).toBeChecked();
    await expect(
      tasks.getByText(new RegExp(`Fait le .* par ${accounts.assistant.name}`)),
    ).toBeVisible();
  });
});
