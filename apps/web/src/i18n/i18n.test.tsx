import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderRoute, signedOut } from "@/test/render";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";
import { createI18n, directionOf } from "./index";

/** Lists every key path in a nested translation object. */
function keysOf(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? keysOf(child as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

describe("translations", () => {
  it("French and Arabic define the same keys (plural forms aside)", () => {
    const base = (locale: object) =>
      [...new Set(keysOf(locale).map((k) => k.replace(PLURAL_SUFFIX, "")))].sort();
    expect(base(ar)).toEqual(base(fr));
  });

  it("defines every plural form each language needs", () => {
    for (const [language, locale] of [
      ["fr", fr],
      ["ar", ar],
    ] as const) {
      const keys = keysOf(locale);
      const plurals = new Set(
        keys.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, "")),
      );
      const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      for (const key of plurals) {
        for (const category of categories) {
          expect(keys, `${language}: ${key}_${category}`).toContain(`${key}_${category}`);
        }
      }
    }
  });

  it("has no empty strings", () => {
    for (const [name, locale] of [
      ["fr", fr],
      ["ar", ar],
    ] as const) {
      const empty = keysOf(locale).filter((key) => {
        const text = key
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], locale);
        return typeof text !== "string" || text.trim() === "";
      });
      expect(empty, name).toEqual([]);
    }
  });
});

describe("document language and direction", () => {
  it("maps Arabic to right-to-left and French to left-to-right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("fr")).toBe("ltr");
  });

  it("starts in French by default", () => {
    createI18n();
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("switches lang and dir and remembers the choice", async () => {
    mockApi({ "GET /api/auth/session": signedOut() });
    renderRoute("/login", "fr");

    const arabic = await screen.findByRole("button", { name: "العربية" });
    expect(arabic).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(arabic);

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("lexora.language")).toBe("ar");

    // A fresh instance picks up the remembered language.
    act(() => {
      createI18n();
    });
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("ignores an invalid stored value", () => {
    window.localStorage.setItem("lexora.language", "<script>");
    createI18n();
    expect(document.documentElement.lang).toBe("fr");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => createI18n()).not.toThrow();
    expect(document.documentElement.lang).toBe("fr");
  });
});
