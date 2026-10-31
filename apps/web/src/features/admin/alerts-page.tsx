import {
  alertResponseSchema,
  alertViews,
  resolveAlertRequestSchema,
  type AlertView,
  type SecurityAlert,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { BellRing, CheckCheck, Eye } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, PageHeader } from "@/components/ui/feedback";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { Pagination } from "@/features/matters/matter-ui";
import { isApiError, send } from "@/lib/api";
import { useAlerts, useInvalidateAlerts, useOfficeDateTime } from "./audit-queries";

/** The audit-log view behind an alert: the account or address, or the event itself. */
function evidenceLink(alert: SecurityAlert): string {
  switch (alert.kind) {
    case "login_failures_account":
    case "access_denied":
    case "break_glass":
      return `/admin/audit?actorId=${alert.user?.id ?? alert.subject}`;
    case "login_failures_ip":
      return "/admin/audit?action=auth.login";
    case "backup_failed":
    case "backup_overdue":
      return "/admin/audit?action=backup.run";
    case "audit_chain":
      return "/admin/audit?action=audit.verify";
  }
}

function ResolveDialog({ alert, onClose }: { alert: SecurityAlert; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateAlerts();
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);
  const resolve = useMutation({
    mutationFn: () =>
      send("POST", `/api/admin/alerts/${alert.id}/resolve`, { note }, alertResponseSchema),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t("alerts.resolveTitle")}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const ok = resolveAlertRequestSchema.safeParse({ note }).success;
          setInvalid(!ok);
          if (ok) resolve.mutate();
        }}
      >
        {resolve.isError && (
          <Alert tone="danger">
            {isApiError(resolve.error, "conflict")
              ? t("alerts.alreadyHandled")
              : errorMessage(resolve.error)}
          </Alert>
        )}
        <Field
          label={t("alerts.note")}
          hint={t("alerts.noteHint")}
          error={invalid ? t("form.invalid") : undefined}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={resolve.isPending}>
            {t("alerts.resolve")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AlertItem({ alert, onResolve }: { alert: SecurityAlert; onResolve: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const dateTime = useOfficeDateTime();
  const invalidate = useInvalidateAlerts();
  const acknowledge = useMutation({
    mutationFn: () =>
      send("POST", `/api/admin/alerts/${alert.id}/acknowledge`, undefined, alertResponseSchema),
    onSuccess: invalidate,
  });
  const title = t(`alertKinds.${alert.kind}`);
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span>{title}</span>
          <Badge tone={alert.severity === "critical" ? "danger" : "accent"}>
            {t(`alertSeverities.${alert.severity}`)}
          </Badge>
          {alert.status === "acknowledged" && <Badge>{t("alertStatuses.acknowledged")}</Badge>}
        </p>
        <p className="text-sm">{t(`alertDescriptions.${alert.kind}`, { n: alert.count })}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
          {alert.user && <span>{alert.user.displayName}</span>}
          {alert.kind === "login_failures_ip" && (
            <bdi dir="ltr" className="font-mono text-xs">
              {alert.subject}
            </bdi>
          )}
          <span>
            {alert.firstSeenAtOffice === alert.lastSeenAtOffice
              ? dateTime(alert.lastSeenAtOffice)
              : t("alerts.between", {
                  from: dateTime(alert.firstSeenAtOffice),
                  to: dateTime(alert.lastSeenAtOffice),
                })}
          </span>
        </p>
        {alert.acknowledgedBy && alert.status !== "resolved" && (
          <p className="text-sm text-muted">
            {t("alerts.acknowledgedBy", { name: alert.acknowledgedBy.displayName })}
          </p>
        )}
        {alert.resolvedBy && alert.resolutionNote && (
          <p className="text-sm text-muted">
            {t("alerts.resolvedBy", {
              name: alert.resolvedBy.displayName,
              note: alert.resolutionNote,
            })}
          </p>
        )}
        <Link
          to={evidenceLink(alert)}
          className="inline-flex min-h-11 items-center text-sm underline decoration-accent underline-offset-4"
        >
          {t("alerts.evidence")}
        </Link>
        {acknowledge.isError && <Alert tone="danger">{errorMessage(acknowledge.error)}</Alert>}
      </div>
      {alert.status !== "resolved" && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {alert.status === "open" && (
            <Button
              variant="outline"
              disabled={acknowledge.isPending}
              aria-label={t("alerts.acknowledgeNamed", { title })}
              onClick={() => {
                acknowledge.mutate();
              }}
            >
              <Eye className="size-4" aria-hidden="true" />
              {t("alerts.acknowledge")}
            </Button>
          )}
          <Button
            variant="outline"
            aria-label={t("alerts.resolveNamed", { title })}
            onClick={onResolve}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            {t("alerts.resolve")}
          </Button>
        </div>
      )}
    </li>
  );
}

export function AlertsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [view, setView] = useState<AlertView>("unresolved");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<SecurityAlert | null>(null);
  const alerts = useAlerts(view, page);

  return (
    <div className="space-y-8">
      <PageHeader title={t("alerts.title")} description={t("alerts.description")} />
      <div className="max-w-xs">
        <Field label={t("alerts.show")}>
          {(props) => (
            <Select
              {...props}
              value={view}
              onChange={(e) => {
                setView(e.target.value as AlertView);
                setPage(1);
              }}
            >
              {alertViews.map((v) => (
                <option key={v} value={v}>
                  {t(`alertViews.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {alerts.isPending && <p className="text-muted">{t("common.loading")}</p>}
      {alerts.isError && <Alert tone="danger">{errorMessage(alerts.error)}</Alert>}
      {alerts.data?.alerts.length === 0 && (
        <p className="flex items-center gap-2 text-muted">
          <BellRing className="size-4" aria-hidden="true" />
          {t(`alerts.empty.${view}`)}
        </p>
      )}
      {alerts.data && alerts.data.alerts.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {alerts.data.alerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onResolve={() => {
                  setResolving(alert);
                }}
              />
            ))}
          </ul>
        </Card>
      )}
      {alerts.data && (
        <Pagination page={alerts.data.page} hasMore={alerts.data.hasMore} onPage={setPage} />
      )}
      {resolving && (
        <ResolveDialog
          alert={resolving}
          onClose={() => {
            setResolving(null);
          }}
        />
      )}
    </div>
  );
}
