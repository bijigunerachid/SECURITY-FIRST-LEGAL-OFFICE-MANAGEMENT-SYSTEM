import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

/**
 * Shown when rendering fails. Never displays the error itself: messages and
 * stack traces can contain internal details.
 */
export function RouteErrorPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <section role="alert" aria-labelledby="error-title" className="mx-auto max-w-xl text-center">
        <h1 id="error-title" className="text-2xl font-semibold tracking-tight">
          {t("error.title")}
        </h1>
        <p className="mt-2 text-muted">{t("error.body")}</p>
        <Button
          className="mt-6"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t("error.reload")}
        </Button>
      </section>
    </AppShell>
  );
}
