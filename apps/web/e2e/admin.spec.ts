import { adminFor, freshAdminFor, PASSWORD, signIn, totpCode } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

test.describe("administrator", () => {
  test("creates an account, and the new person sets a password with the link and signs in", async ({
    browser,
  }, testInfo) => {
    const { state } = adminFor(testInfo.project.name);
    const adminContext = await browser.newContext({ storageState: state });
    const page = await adminContext.newPage();
    const email = `new.${testInfo.project.name}@e2e.test`;

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Utilisateurs");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`users-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Ajouter un utilisateur" }).click();
    const create = page.getByRole("dialog", { name: "Nouvel utilisateur" });
    await create.getByLabel("Nom").fill("Salma Nouvelle");
    await create.getByLabel("E-mail").fill(email);
    await create.getByLabel("Rôle").selectOption("assistant");
    await create.getByRole("button", { name: "Créer le compte" }).click();

    // Sensitive action: the server asks to confirm identity first.
    const reauth = page.getByRole("dialog", { name: "Confirmez votre identité" });
    await expect(reauth).toBeVisible();
    await expectNoA11yViolations(page);
    await reauth.getByLabel("Mot de passe").fill(PASSWORD);
    // A code from the next 30-second step: the sign-in code may not be reused.
    await reauth.getByLabel("Code de vérification").fill(totpCode(undefined, 1));
    await reauth.getByRole("button", { name: "Confirmer" }).click();

    const link = (await page.getByTestId("password-link").textContent()) ?? "";
    expect(link).toMatch(/\/set-password#token=[A-Za-z0-9_-]{43}$/);
    await page.screenshot({ path: testInfo.outputPath(`users-link-${testInfo.project.name}.png`) });
    await adminContext.close();

    // The new person, in their own browser.
    const personContext = await browser.newContext();
    const person = await personContext.newPage();
    await person.goto(link);
    await expect(person.getByRole("heading", { level: 1 })).toHaveText(
      "Choisir votre mot de passe",
    );
    // The token is removed from the address bar after reading.
    expect(new URL(person.url()).hash).toBe("");
    await person.getByLabel("Nouveau mot de passe").fill("quiet morning train to the coast");
    await person.getByLabel("Confirmer le mot de passe").fill("quiet morning train to the coast");
    await person.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await expect(person.getByText("Mot de passe enregistré")).toBeVisible();

    // The link works only once (opened again, as a person would, in a new tab).
    const again = await personContext.newPage();
    await again.goto(link);
    await again.getByLabel("Nouveau mot de passe").fill("another long passphrase here");
    await again.getByLabel("Confirmer le mot de passe").fill("another long passphrase here");
    await again.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
    await expect(again.getByRole("alert")).toContainText("n'est plus valide");

    await signIn(person, email, "quiet morning train to the coast");
    await expect(
      person.getByRole("heading", { level: 1, name: "Bonjour, Salma Nouvelle" }),
    ).toBeVisible();
    await personContext.close();
  });

  test("must set up a second factor at first sign-in, then sees recovery codes", async ({
    page,
  }, testInfo) => {
    const fresh = freshAdminFor(testInfo.project.name);
    await signIn(page, fresh.email);
    await expect(page).toHaveURL(/\/setup-mfa$/);
    await expect(page.getByRole("img", { name: /Code QR/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`mfa-setup-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // Until the second factor is set up, nothing else is reachable.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/setup-mfa$/);

    const secret = ((await page.getByTestId("totp-secret").textContent()) ?? "").replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel("Code de vérification").fill(totpCode(secret));
    await page.getByRole("button", { name: "Activer" }).click();

    await expect(page.getByText("Vos codes de secours")).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: /^[2-9A-Z]{5}-[2-9A-Z]{5}-[2-9A-Z]{5}$/ }),
    ).toHaveCount(10);
    await switchToArabic(page);
    await expectNoA11yViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`mfa-codes-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "لقد حفظت رموزي الاحتياطية" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `مرحبًا، ${fresh.name}` }),
    ).toBeVisible();
  });
});
