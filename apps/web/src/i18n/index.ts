import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";

export const LANGUAGES = ["fr", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "fr";

const RTL_LANGUAGES = new Set<Language>(["ar"]);
const STORAGE_KEY = "lexora.language";

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

export const directionOf = (language: Language): "rtl" | "ltr" =>
  RTL_LANGUAGES.has(language) ? "rtl" : "ltr";

/**
 * The chosen language is a harmless preference, so it may live in
 * localStorage. Storage can be unavailable (private windows, blocked site
 * data), so every access is guarded.
 */
function readStoredLanguage(): Language | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not critical: the choice simply will not be remembered.
  }
}

function applyToDocument(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = directionOf(language);
}

export function createI18n(initialLanguage?: Language): i18n {
  const instance = i18next.createInstance();
  const language = initialLanguage ?? readStoredLanguage() ?? DEFAULT_LANGUAGE;

  void instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, ar: { translation: ar } },
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    // React already escapes output; i18next must not double-escape.
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });

  applyToDocument(language);
  instance.on("languageChanged", (next) => {
    if (isLanguage(next)) {
      applyToDocument(next);
      storeLanguage(next);
    }
  });

  return instance;
}
