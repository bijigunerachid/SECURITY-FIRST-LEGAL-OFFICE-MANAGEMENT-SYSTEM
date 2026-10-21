import { accounts, PASSWORD, signIn, storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

test.describe("signing in and out", () => {
  test("refuses a wrong password with a generic message, then signs in and out", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expectNoA11yViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`login-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await signIn(page, accounts.lawyer.email, "not the right password");
    await expect(page.getByRole("alert")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
    await expect(page.getByLabel("Mot de passe")).toHaveValue("");

    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Bonjour, ${accounts.lawyer.name}` }),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Sécurité" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Utilisateurs" })).toHaveCount(0);

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page.getByRole("status")).toHaveText("Vous avez été déconnecté.");
    // The old session is gone: protected pages send the browser back to sign-in.
    await page.goto("/security");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("has an accessible, right-to-left sign-in page in Arabic", async ({ page }, testInfo) => {
    await page.goto("/login");
    await switchToArabic(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تسجيل الدخول");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`login-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe("as a lawyer", () => {
  test.use({ storageState: storageState.lawyer });

  test("cannot open user administration", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  });

  test("sees an accessible security page", async ({ page }, testInfo) => {
    await page.goto("/security");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sécurité du compte");
    await expect(page.getByRole("button", { name: "Activer" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`security-fr-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await switchToArabic(page);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`security-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
