import { Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { LanguageSwitcher } from "@/components/language-switcher";

export function AppShell({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        {t("app.skipToContent")}
      </a>

      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3 rounded-md">
            <span
              className="flex size-10 items-center justify-center rounded-lg bg-brand text-brand-ink"
              aria-hidden="true"
            >
              <Scale className="size-5" strokeWidth={1.75} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-lg font-semibold tracking-tight">{t("app.name")}</span>
              {/* Hidden on phones so the header stays on one line in every language. */}
              <span className="hidden text-xs text-muted sm:block">{t("app.tagline")}</span>
            </span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12"
      >
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto max-w-5xl px-4 py-4 text-xs text-muted sm:px-6">{t("app.footer")}</p>
      </footer>
    </div>
  );
}
