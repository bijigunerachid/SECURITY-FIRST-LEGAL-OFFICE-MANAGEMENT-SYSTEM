import { useMutation } from "@tanstack/react-query";
import { LogOut, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { useForgetEverything, useSession } from "@/features/auth/session";
import { send } from "@/lib/api";
import { cn } from "@/lib/utils";

function MainNav() {
  const { t } = useTranslation();
  const user = useSession().data?.user;
  const links = [
    { to: "/", label: t("nav.home"), end: true },
    { to: "/security", label: t("nav.security"), end: false },
    ...(user?.role === "admin" ? [{ to: "/admin/users", label: t("nav.users"), end: false }] : []),
    { to: "/status", label: t("nav.status"), end: false },
  ];
  return (
    <nav aria-label={t("nav.label")} className="border-t border-border">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap",
                  isActive
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AccountMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const forgetEverything = useForgetEverything();
  const user = useSession().data?.user;
  const logout = useMutation({
    mutationFn: () => send("POST", "/api/auth/logout"),
    onSettled: async () => {
      forgetEverything();
      await navigate("/login", { replace: true, state: { signedOut: true } });
    },
  });
  if (!user) return null;
  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden text-sm text-muted md:inline"
        aria-label={t("nav.account", { name: user.displayName })}
      >
        {user.displayName} · {t(`roles.${user.role}`)}
      </span>
      <Button
        variant="ghost"
        aria-label={t("nav.signOut")}
        onClick={() => {
          logout.mutate();
        }}
      >
        <LogOut className="size-4 rtl:rotate-180" aria-hidden="true" />
        <span className="hidden sm:inline">{t("nav.signOut")}</span>
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  const signedIn = useSession().data?.state === "active";

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        {t("app.skipToContent")}
      </a>

      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-md">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-ink"
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
          <div className="flex items-center gap-2">
            {signedIn && <AccountMenu />}
            <LanguageSwitcher />
          </div>
        </div>
        {signedIn && <MainNav />}
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
