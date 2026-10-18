import { CircleAlert, CircleCheck, CircleX, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReadiness } from "./use-readiness";

type CheckState = "ok" | "unavailable";

function StatusRow({ label, state }: { label: string; state: CheckState }) {
  const { t } = useTranslation();
  const ok = state === "ok";
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {ok ? t("status.operational") : t("status.unavailable")}
      </span>
    </li>
  );
}

export function StatusPage() {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, isFetching, refetch, dataUpdatedAt } = useReadiness();

  const time = new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA", {
    timeStyle: "medium",
  }).format(dataUpdatedAt);

  return (
    <section aria-labelledby="status-title" className="mx-auto max-w-xl">
      <h1 id="status-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("status.title")}
      </h1>
      <p className="mt-2 text-muted">{t("status.description")}</p>

      <div
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6"
        aria-live="polite"
        aria-busy={isFetching}
      >
        {isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            {t("status.checking")}
          </p>
        ) : isError ? (
          <div role="alert" className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <h2 className="font-medium">{t("status.unreachableTitle")}</h2>
              <p className="mt-1 text-sm text-muted">{t("status.unreachableBody")}</p>
            </div>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              <StatusRow label={t("status.api")} state="ok" />
              <StatusRow label={t("status.database")} state={data.checks.database} />
            </ul>
            <p className="mt-3 text-xs text-muted">{t("status.lastChecked", { time })}</p>
          </>
        )}

        {!isPending && (
          <Button
            variant="outline"
            className="mt-5 w-full sm:w-auto"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} aria-hidden="true" />
            {t("status.retry")}
          </Button>
        )}
      </div>
    </section>
  );
}
