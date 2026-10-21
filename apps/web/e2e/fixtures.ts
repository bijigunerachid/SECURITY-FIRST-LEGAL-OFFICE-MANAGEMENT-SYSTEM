import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Chrome reports every HTTP error response as a console error. 401, 403 and
 * 404 from the API are expected answers here (signed-out session check,
 * "confirm your identity", and a matter the user may not see, which the API
 * reports as not found), so only those exact messages are ignored.
 */
const EXPECTED_NETWORK_ERROR =
  /Failed to load resource: the server responded with a status of 40[134]/;

/**
 * Fails any test in which the page logs an unexpected error or the browser
 * reports a Content Security Policy violation.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !EXPECTED_NETWORK_ERROR.test(message.text())) {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        errors.push(error.message);
      });
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * For a test that deliberately triggers refused requests (for example an
 * upload the scanner rejects): removes exactly one console message per
 * listed status, so any other error still fails the test.
 */
export function expectRefusals(consoleErrors: string[], statuses: number[]): void {
  for (const status of statuses) {
    const index = consoleErrors.findIndex((message) =>
      message.includes(`the server responded with a status of ${status}`),
    );
    expect(index, `console message for HTTP ${status}`).toBeGreaterThanOrEqual(0);
    consoleErrors.splice(index, 1);
  }
}

/** The page must never scroll sideways (a common RTL and phone layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in pixels").toBeLessThanOrEqual(0);
}

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Waits until CSS transitions and other finite animations have finished.
 * Scanning mid-transition (for example right after switching language) can
 * read colours halfway between two states and report a contrast failure
 * that no user ever sees. Infinite animations (spinners) are ignored.
 */
async function waitForSettledStyles(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}

export async function expectNoA11yViolations(page: Page): Promise<void> {
  await waitForSettledStyles(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

export async function switchToArabic(page: Page): Promise<void> {
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}
