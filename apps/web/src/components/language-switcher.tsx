import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LANGUAGES, isLanguage } from "@/i18n";

/** A two-option toggle. Each option is labelled in its own language. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : "fr";

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="flex rounded-md border border-border bg-surface p-0.5"
    >
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-pressed={current === language}
          onClick={() => void i18n.changeLanguage(language)}
          className={cn(
            "min-h-10 min-w-16 cursor-pointer rounded px-3 text-sm font-medium transition-colors",
            current === language ? "bg-brand text-brand-ink" : "text-muted hover:text-ink",
          )}
        >
          {t(`language.${language}`)}
        </button>
      ))}
    </div>
  );
}
