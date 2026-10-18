import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="not-found-title" className="mx-auto max-w-xl text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 id="not-found-title" className="mt-2 text-2xl font-semibold tracking-tight">
        {t("notFound.title")}
      </h1>
      <p className="mt-2 text-muted">{t("notFound.body")}</p>
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
      >
        {t("notFound.back")}
      </Link>
    </section>
  );
}
