import type { MatterStatus, MatterSummary } from "@lexora/shared";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Dialog } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { useFormat } from "./queries";

const statusTone: Record<MatterStatus, "success" | "neutral" | "danger"> = {
  open: "success",
  on_hold: "neutral",
  closed: "neutral",
};

export function MatterStatusBadge({ status }: { status: MatterStatus }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone[status]}>{t(`matterStatuses.${status}`)}</Badge>;
}

export function RestrictedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <Lock className="size-3" aria-hidden="true" />
      {t("matters.restricted")}
    </Badge>
  );
}

/** One matter in a list: the whole row is a link to the matter. */
export function MatterListItem({ matter }: { matter: MatterSummary }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <li>
      <Link
        to={`/matters/${matter.id}`}
        className="flex flex-col gap-2 p-4 hover:bg-surface-muted sm:px-6"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{matter.title}</span>
          <MatterStatusBadge status={matter.status} />
          {matter.restricted && <RestrictedBadge />}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span dir="ltr" className="font-mono">
            {matter.reference}
          </span>
          <span>{matter.client.name}</span>
          <span>{t(`areas.${matter.area}`)}</span>
          <span>
            {matter.lead
              ? t("matters.lead", { name: matter.lead.displayName })
              : t("matters.noLead")}
          </span>
          <span>
            {t("matters.openedOn")} {format.date(matter.openedOn)}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function Pagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (page === 1 && !hasMore) return null;
  return (
    <nav
      aria-label={t("common.pageOf", { page })}
      className="flex items-center justify-between gap-2"
    >
      <Button
        variant="outline"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t("common.previous")}
      </Button>
      <span className="text-sm text-muted">{t("common.pageOf", { page })}</span>
      <Button
        variant="outline"
        disabled={!hasMore}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        {t("common.next")}
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </nav>
  );
}

/** Asks before an action that removes something or hands over control. */
export function ConfirmDialog({
  open,
  title,
  message,
  error,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  error?: string | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm">{message}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {t("common.continue")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Shown for a record that does not exist or that the user may not see (the API answers 404 for both). */
export function NotFoundNotice({
  title,
  body,
  backTo,
  backLabel,
}: {
  title: string;
  body: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 id="page-title" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="text-muted">{body}</p>
      <Link
        to={backTo}
        className="inline-flex min-h-11 items-center text-ink underline decoration-accent decoration-2 underline-offset-4"
      >
        {backLabel}
      </Link>
    </div>
  );
}

/** A label and its value, in a description list. */
export function Detail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  // Each label/value pair is one <div> directly inside the <dl>, as HTML requires.
  return (
    <div className={cn("space-y-0.5", className)}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}
