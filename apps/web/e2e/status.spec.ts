import { storageState } from "./accounts";
import {
  expect,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  switchToArabic,
  test,
} from "./fixtures";

test.use({ storageState: storageState.lawyer });

test.describe("system status page", () => {
  test("shows the real API and database as operational, in French by default", async ({ page }) => {
    await page.goto("/status");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("État du système");
    await expect(page.getByText("Opérationnel")).toHaveCount(2);
    await expectNoHorizontalScroll(page);
  });

  test("switches to Arabic, right-to-left, and remembers it after a reload", async ({ page }) => {
    await page.goto("/status");
    await switchToArabic(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("حالة النظام");
    await expect(page.getByText("يعمل")).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("explains what to do when the server cannot be reached, and recovers on retry", async ({
    page,
    consoleErrors,
  }) => {
    let failNext = true;
    await page.route("**/api/health/ready", async (route) => {
      if (failNext) {
        failNext = false;
        await route.abort("connectionrefused");
        return;
      }
      await route.continue();
    });
    await page.goto("/status");
    await expect(page.getByRole("alert")).toContainText("Impossible de joindre le serveur");
    await page.getByRole("button", { name: "Réessayer" }).click();
    await expect(page.getByText("Opérationnel")).toHaveCount(2);
    // The aborted request is logged by the browser itself; that one is expected.
    consoleErrors.splice(
      0,
      consoleErrors.length,
      ...consoleErrors.filter((e) => !e.includes("ERR_CONNECTION_REFUSED")),
    );
  });

  test("shows a helpful page for unknown addresses", async ({ page }) => {
    await page.goto("/clients/123");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
    await page.getByRole("link", { name: "Retour à l'accueil" }).click();
    await expect(page).toHaveURL("/");
  });

  test("has a working skip link for keyboard users", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard navigation is checked on desktop.");
    await page.goto("/status");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Aller au contenu principal" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("has no WCAG A/AA violations in French and Arabic", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByText("Opérationnel")).toHaveCount(2);
    await expectNoA11yViolations(page);
    await switchToArabic(page);
    await expectNoA11yViolations(page);
  });
});

test.describe("security headers on the built application", () => {
  test("sends the production Content Security Policy and related headers", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-inline");
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("keeps API responses out of caches", async ({ request }) => {
    const response = await request.get("/api/health/ready");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
});
