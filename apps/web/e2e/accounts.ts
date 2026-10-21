import { readFileSync } from "node:fs";
import { Secret, TOTP } from "otpauth";
import type { Page } from "@playwright/test";

interface AccountsFile {
  password: string;
  totpSecret: string;
  accounts: Record<string, { email: string; name: string; role: string; mfa: boolean }>;
}

/** The same synthetic accounts the seed script creates. */
const data = JSON.parse(
  readFileSync(new URL("../../api/scripts/e2e-accounts.json", import.meta.url), "utf8"),
) as AccountsFile;

export const PASSWORD = data.password;
export const accounts = data.accounts as Record<
  "adminDesktop" | "adminPhone" | "lawyer" | "freshAdminDesktop" | "freshAdminPhone",
  AccountsFile["accounts"][string]
>;

export const storageState = {
  adminDesktop: "test-results/.auth/admin-desktop.json",
  adminPhone: "test-results/.auth/admin-phone.json",
  lawyer: "test-results/.auth/lawyer.json",
};

/** Authenticator code for a secret, `offsetSteps` periods of 30 s from now. */
export function totpCode(secret: string = data.totpSecret, offsetSteps = 0): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: Date.now() + offsetSteps * 30_000,
  });
}

/** Admin account for the current project, so parallel projects never share one. */
export function adminFor(projectName: string) {
  return projectName === "phone"
    ? { account: accounts.adminPhone, state: storageState.adminPhone }
    : { account: accounts.adminDesktop, state: storageState.adminDesktop };
}

export function freshAdminFor(projectName: string) {
  return projectName === "phone" ? accounts.freshAdminPhone : accounts.freshAdminDesktop;
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}
