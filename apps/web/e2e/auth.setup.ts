import { expect, test as setup } from "@playwright/test";
import { accounts, signIn, storageState, totpCode } from "./accounts";

/** Signs each role in once and saves the browser state for the other tests. */

for (const [key, file] of [
  ["adminDesktop", storageState.adminDesktop],
  ["adminPhone", storageState.adminPhone],
] as const) {
  setup(`sign in ${key}`, async ({ page }) => {
    await signIn(page, accounts[key].email);
    await expect(page.getByRole("heading", { name: "Vérification en deux étapes" })).toBeVisible();
    await page.getByLabel("Code de vérification").fill(totpCode());
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `Bonjour, ${accounts[key].name}` }),
    ).toBeVisible();
    await page.context().storageState({ path: file });
  });
}

setup("sign in lawyer", async ({ page }) => {
  await signIn(page, accounts.lawyer.email);
  await expect(
    page.getByRole("heading", { level: 1, name: `Bonjour, ${accounts.lawyer.name}` }),
  ).toBeVisible();
  await page.context().storageState({ path: storageState.lawyer });
});
