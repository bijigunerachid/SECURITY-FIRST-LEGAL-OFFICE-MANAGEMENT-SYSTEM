import { accounts, breakGlassAdminFor, PASSWORD, signIn, storageState, totpCode } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

/**
 * One matter, followed through every kind of user. The tests share it, so
 * they run in order; desktop and phone each create their own matter.
 */
test.describe.configure({ mode: "serial" });

const shared = { url: "", reference: "", client: "", title: "" };

test.describe("a lawyer", () => {
  test.use({ storageState: storageState.lawyer });

  test("opens a matter for a new client after a conflict check, then builds the team", async ({
    page,
  }, testInfo) => {
    const stamp = `${testInfo.project.name} ${Date.now().toString(36)}`;
    shared.client = `Client E2E ${stamp}`;
    shared.title = `Litige locatif ${stamp}`;

    await page.goto("/matters/new");
    await expect(page.getByRole("heading", { level: 1, name: "Nouveau dossier" })).toBeVisible();
    await page.getByRole("radio", { name: "Nouveau client" }).click();
    await page.getByLabel("Nom ou raison sociale").fill(shared.client);
    await page.getByLabel("Intitulé du dossier").fill(shared.title);
    await page.getByLabel("Domaine").selectOption("real_estate");

    // Opening without a conflict check is refused by the form.
    await page.getByRole("button", { name: "Ouvrir le dossier" }).click();
    await expect(page.getByText("Lancez la recherche de conflits")).toBeVisible();

    await page.getByRole("button", { name: "Rechercher les conflits" }).click();
    await expect(page.getByText(`Aucune correspondance pour « ${shared.client} ».`)).toBeVisible();
    // The warning goes away once the check has been done.
    await expect(page.getByText("Lancez la recherche de conflits")).toHaveCount(0);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`new-matter-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Ouvrir le dossier" }).click();
    await expect(page.getByRole("heading", { level: 1, name: shared.title })).toBeVisible();
    shared.url = new URL(page.url()).pathname;
    shared.reference = (await page.getByText(/^\d{4}-\d{4,6}$/).textContent()) ?? "";
    expect(shared.reference).toMatch(/^\d{4}-\d{4,6}$/);
    await expect(page.getByText("Vous êtes responsable de ce dossier.")).toBeVisible();

    // Team: add the assistant.
    await page.getByRole("button", { name: "Ajouter à l'équipe" }).click();
    const add = page.getByRole("dialog", { name: "Ajouter une personne à l'équipe" });
    await add
      .getByLabel("Personne")
      .selectOption({ label: `${accounts.assistant.name} · Assistant` });
    await add.getByRole("button", { name: "Ajouter" }).click();
    await expect(add).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Retirer ${accounts.assistant.name} de l'équipe` }),
    ).toBeVisible();

    // Parties: the opposing party.
    await page.getByRole("button", { name: "Ajouter une partie" }).click();
    const party = page.getByRole("dialog", { name: "Nouvelle partie" });
    await party.getByLabel("Nom ou raison sociale").fill(`Bailleur Adverse ${stamp}`);
    await party.getByRole("button", { name: "Enregistrer" }).click();
    await expect(party).toBeHidden();
    await expect(page.getByText(`Bailleur Adverse ${stamp}`)).toBeVisible();

    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`matter-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await switchToArabic(page);
    await expect(page.getByRole("heading", { level: 2, name: "الفريق" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`matter-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test("finds the client in the client list", async ({ page }, testInfo) => {
    await page.goto("/clients");
    await page.getByLabel("Rechercher un client").fill(shared.client);
    await page.getByRole("button", { name: "Rechercher" }).click();
    const row = page.getByRole("link", { name: new RegExp(shared.client) });
    await expect(row).toContainText("1 dossier");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`clients-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: shared.client })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(shared.title) })).toBeVisible();
  });
});

test.describe("an assistant on the team", () => {
  test.use({ storageState: storageState.assistant });

  test("sees the matter and its parties, but cannot change its details or team", async ({
    page,
  }, testInfo) => {
    await page.goto("/matters");
    await page.getByLabel("Rechercher un dossier").fill(shared.title);
    await page.getByRole("button", { name: "Rechercher" }).click();
    await page.getByRole("link", { name: new RegExp(shared.title) }).click();
    await expect(page.getByRole("heading", { level: 1, name: shared.title })).toBeVisible();
    await expect(page.getByText("Vous faites partie de l'équipe de ce dossier.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Modifier les informations" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter à l'équipe" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter une partie" })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`matter-assistant-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe("a lawyer outside the team", () => {
  test.use({ storageState: storageState.colleague });

  test("cannot open the matter, and the conflict search shows only what is needed", async ({
    page,
  }, testInfo) => {
    await page.goto(shared.url);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dossier introuvable" }),
    ).toBeVisible();

    await page.goto("/conflicts");
    await page.getByLabel("Nom, raison sociale ou identifiant").fill(shared.client);
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByText(`1 correspondance pour « ${shared.client} »`)).toBeVisible();
    await expect(page.getByText(shared.reference)).toBeVisible();
    await expect(page.getByText(`À voir avec : ${accounts.lawyer.name}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ouvrir le dossier" })).toHaveCount(0);
    await expect(page.getByText(shared.title)).toHaveCount(0);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`conflicts-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe("an administrator", () => {
  test("reads the matter only through audited, time-limited break-glass access", async ({
    page,
  }, testInfo) => {
    const admin = breakGlassAdminFor(testInfo.project.name);
    await signIn(page, admin.email);
    await page.getByLabel("Code de vérification").fill(totpCode());
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Bonjour, ${admin.name}` }),
    ).toBeVisible();

    // Without break-glass access, the matter does not exist for an administrator.
    await page.goto(shared.url);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dossier introuvable" }),
    ).toBeVisible();

    await page.goto("/admin/break-glass");
    await page.getByLabel("Référence du dossier").fill(shared.reference);
    await page.getByLabel("Motif").fill("Avocat injoignable, audience demain à 9 h (test E2E).");
    await page.getByRole("button", { name: "Ouvrir l'accès d'urgence" }).click();

    const reauth = page.getByRole("dialog", { name: "Confirmez votre identité" });
    await reauth.getByLabel("Mot de passe").fill(PASSWORD);
    await reauth.getByLabel("Code de vérification").fill(totpCode(undefined, 1));
    await reauth.getByRole("button", { name: "Confirmer" }).click();

    await expect(page.getByRole("heading", { level: 1, name: shared.title })).toBeVisible();
    await expect(page.getByText(/Accès d'urgence en lecture seule/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Modifier|Ajouter|Retirer/ })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`break-glass-matter-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.goto("/admin/break-glass");
    await expectNoA11yViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`break-glass-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: `Mettre fin à l'accès ${shared.reference}` }).click();
    await expect(page.getByText("Aucun accès d'urgence en cours.")).toBeVisible();
    await page.goto(shared.url);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dossier introuvable" }),
    ).toBeVisible();
  });
});
