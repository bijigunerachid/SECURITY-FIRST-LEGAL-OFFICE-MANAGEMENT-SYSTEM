import {
  auditOutcomes,
  auditQuerySchema,
  auditVerificationResponseSchema,
  type AuditEvent,
  type AuditOutcome,
  type AuditQuery,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader, Section } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { send } from "@/lib/api";
import { useActionLabel, useAuditEvents, useOfficeDateTime } from "./audit-queries";

/** Action families offered as filters; any action code can also be typed. */
const ACTION_GROUPS = [
  "auth.",
  "admin.",
  "matter.",
  "client.",
  "document.",
  "invoice.",
  "payment.",
  "alert.",
  "audit.",
] as const;

const outcomeTone: Record<AuditOutcome, "success" | "danger" | "neutral"> = {
  success: "success",
  failure: "danger",
  denied: "danger",
};

type Filters = Omit<AuditQuery, "before">;

/** Filters live in the address, so a filtered view can be linked (e.g. from the users page). */
function filtersFrom(params: URLSearchParams): Filters {
  const raw = Object.fromEntries(
    ["action", "outcome", "actorId", "targetType", "targetId", "from", "to"]
      .map((k): [string, string] => [k, params.get(k) ?? ""])
      .filter(([, v]) => v !== ""),
  );
  const parsed = auditQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function EventItem({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  const label = useActionLabel();
  const dateTime = useOfficeDateTime();
  const details = event.metadata && Object.keys(event.metadata).length > 0;
  return (
    <li className="space-y-1 p-4 sm:px-6">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label(event.action)}</span>
        <Badge tone={outcomeTone[event.outcome]}>{t(`auditOutcomes.${event.outcome}`)}</Badge>
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
        <span>{dateTime(event.occurredAtOffice)}</span>
        <span>{event.actor ? event.actor.displayName : t("audit.noActor")}</span>
        {event.targetType && (
          <span>
            {t(`auditTargets.${event.targetType}`, { defaultValue: event.targetType })}{" "}
            <bdi dir="ltr" className="font-mono text-xs">
              {event.targetId}
            </bdi>
          </span>
        )}
        {event.ipAddress && (
          <span>
            {t("audit.ip")}{" "}
            <bdi dir="ltr" className="font-mono text-xs">
              {event.ipAddress}
            </bdi>
          </span>
        )}
      </p>
      {details && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center text-muted">
            {t("audit.details")}
          </summary>
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-md bg-surface-muted p-3 text-xs whitespace-pre-wrap break-all"
          >
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
          <p className="mt-1 text-xs text-muted">
            {t("audit.code")}{" "}
            <bdi dir="ltr" className="font-mono">
              {event.action}
            </bdi>
            {event.requestId && (
              <>
                {" · "}
                {t("audit.requestId")}{" "}
                <bdi dir="ltr" className="font-mono">
                  {event.requestId}
                </bdi>
              </>
            )}
          </p>
        </details>
      )}
    </li>
  );
}

function Verify() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const verify = useMutation({
    mutationFn: () =>
      send("POST", "/api/admin/audit/verify", undefined, auditVerificationResponseSchema),
  });
  const result = verify.data?.verification;
  return (
    <Section title={t("audit.verifyTitle")}>
      <p className="text-sm text-muted">{t("audit.verifyHint")}</p>
      <Button
        variant="outline"
        disabled={verify.isPending}
        onClick={() => {
          verify.mutate();
        }}
      >
        <ShieldCheck className="size-4" aria-hidden="true" />
        {verify.isPending ? t("audit.verifying") : t("audit.verify")}
      </Button>
      {verify.isError && <Alert tone="danger">{errorMessage(verify.error)}</Alert>}
      {result &&
        (result.valid ? (
          <Alert tone="success" title={t("audit.validTitle")}>
            {t("audit.valid", { n: result.checked })}
          </Alert>
        ) : (
          <Alert tone="danger" title={t("audit.brokenTitle")}>
            {t("audit.broken", { id: result.firstInvalidId ?? "?" })}
          </Alert>
        ))}
    </Section>
  );
}

export function AuditPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const label = useActionLabel();
  const [params, setParams] = useSearchParams();
  const filters = filtersFrom(params);
  const [draft, setDraft] = useState({
    action: filters.action ?? "",
    outcome: filters.outcome ?? "",
    from: filters.from ?? "",
    to: filters.to ?? "",
  });
  const [invalid, setInvalid] = useState(false);
  const events = useAuditEvents(filters);

  const apply = (event: SyntheticEvent) => {
    event.preventDefault();
    const next = new URLSearchParams();
    // Keep the person or record the view was opened for.
    for (const key of ["actorId", "targetType", "targetId"]) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    for (const [key, value] of Object.entries(draft)) if (value) next.set(key, value);
    const ok = auditQuerySchema.safeParse(Object.fromEntries(next)).success;
    setInvalid(!ok);
    if (ok) setParams(next);
  };
  const narrowed = Boolean(filters.actorId ?? filters.targetId);

  return (
    <div className="space-y-10">
      <PageHeader title={t("audit.title")} description={t("audit.description")} />

      <form noValidate onSubmit={apply} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("audit.action")}>
            {(props) => (
              <Select
                {...props}
                value={draft.action}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, action: e.target.value }));
                }}
              >
                <option value="">{t("audit.allActions")}</option>
                {ACTION_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {t(`auditGroups.${group.slice(0, -1)}`)}
                  </option>
                ))}
                {draft.action && !(ACTION_GROUPS as readonly string[]).includes(draft.action) && (
                  <option value={draft.action}>{label(draft.action)}</option>
                )}
              </Select>
            )}
          </Field>
          <Field label={t("audit.outcome")}>
            {(props) => (
              <Select
                {...props}
                value={draft.outcome}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, outcome: e.target.value }));
                }}
              >
                <option value="">{t("audit.allOutcomes")}</option>
                {auditOutcomes.map((o) => (
                  <option key={o} value={o}>
                    {t(`auditOutcomes.${o}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("audit.from")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.from}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, from: e.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={t("audit.to")} error={invalid ? t("audit.rangeInvalid") : undefined}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.to}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, to: e.target.value }));
                }}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">{t("audit.apply")}</Button>
          {(narrowed || params.toString() !== "") && (
            <Button
              variant="outline"
              onClick={() => {
                setDraft({ action: "", outcome: "", from: "", to: "" });
                setParams(new URLSearchParams());
              }}
            >
              {t("audit.clear")}
            </Button>
          )}
        </div>
        {narrowed && <Alert tone="info">{t("audit.narrowed")}</Alert>}
      </form>

      <Section title={t("audit.events")}>
        {events.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {events.isError && <Alert tone="danger">{errorMessage(events.error)}</Alert>}
        {events.data?.pages[0]?.events.length === 0 && (
          <p className="text-sm text-muted">{t("audit.empty")}</p>
        )}
        {events.data && (events.data.pages[0]?.events.length ?? 0) > 0 && (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {events.data.pages.flatMap((page) =>
                page.events.map((event) => <EventItem key={event.id} event={event} />),
              )}
            </ul>
          </Card>
        )}
        {events.hasNextPage && (
          <Button
            variant="outline"
            disabled={events.isFetchingNextPage}
            onClick={() => {
              void events.fetchNextPage();
            }}
          >
            {t("audit.more")}
          </Button>
        )}
      </Section>

      <Verify />
    </div>
  );
}
