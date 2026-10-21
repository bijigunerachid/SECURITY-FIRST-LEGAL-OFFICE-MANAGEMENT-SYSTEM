import { breakGlassGrantResponseSchema, breakGlassRequestSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader, Section } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ReauthCancelled, useSensitiveAction } from "@/features/auth/reauth";
import { useErrorMessage } from "@/features/auth/use-error-message";
import {
  invalidFields,
  useBreakGlassGrants,
  useFormat,
  useInvalidateMatters,
} from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";
import { ltr } from "@/lib/utils";

/**
 * Break-glass access (decision D2): an administrator opens one matter,
 * read-only, for 60 minutes, after re-entering their password and code and
 * giving a reason. Everything here is audited by the server.
 */
export function BreakGlassPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const sensitive = useSensitiveAction();
  const invalidate = useInvalidateMatters();
  const format = useFormat();
  const grants = useBreakGlassGrants();
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const open = useMutation({
    mutationFn: (body: { reference: string; reason: string }) =>
      sensitive(() => send("POST", "/api/break-glass", body, breakGlassGrantResponseSchema)),
    onSuccess: async ({ grant }) => {
      await invalidate();
      await navigate(`/matters/${grant.matterId}`);
    },
  });
  const end = useMutation({
    mutationFn: (grantId: string) => send("POST", `/api/break-glass/${grantId}/end`),
    onSuccess: invalidate,
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = { reference: reference.trim(), reason };
    const nextInvalid = invalidFields(breakGlassRequestSchema.safeParse(body).error);
    setInvalid(nextInvalid);
    if (nextInvalid.size === 0) open.mutate(body);
  };
  const openError =
    open.isError && !(open.error instanceof ReauthCancelled)
      ? isApiError(open.error, "not_found")
        ? t("breakGlass.unknownReference")
        : errorMessage(open.error)
      : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl space-y-8">
      <PageHeader title={t("breakGlass.title")} description={t("breakGlass.description")} />

      <Card>
        <form noValidate className="space-y-4" onSubmit={submit}>
          {openError && <Alert tone="danger">{openError}</Alert>}
          <Field
            label={t("breakGlass.reference")}
            hint={t("breakGlass.referenceHint")}
            error={invalid.has("reference") ? t("form.invalid") : undefined}
          >
            {(props) => (
              <Input
                {...props}
                dir="ltr"
                autoComplete="off"
                inputMode="numeric"
                maxLength={11}
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label={t("breakGlass.reason")}
            hint={t("breakGlass.reasonHint")}
            error={invalid.has("reason") ? t("breakGlass.reasonHint") : undefined}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            )}
          </Field>
          <Button type="submit" disabled={open.isPending}>
            <ShieldAlert className="size-4" aria-hidden="true" />
            {t("breakGlass.submit")}
          </Button>
        </form>
      </Card>

      <Section title={t("breakGlass.activeTitle")}>
        {grants.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {grants.isError && <Alert tone="danger">{errorMessage(grants.error)}</Alert>}
        {end.isError && <Alert tone="danger">{errorMessage(end.error)}</Alert>}
        {grants.data?.grants.length === 0 && (
          <p className="text-sm text-muted">{t("breakGlass.none")}</p>
        )}
        {grants.data && grants.data.grants.length > 0 && (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {grants.data.grants.map((grant) => (
                <li
                  key={grant.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="min-w-0 space-y-1">
                    <p dir="ltr" className="text-start font-mono font-medium">
                      {grant.reference}
                    </p>
                    <p className="text-sm text-muted">
                      {t("breakGlass.until", { time: format.time(grant.expiresAt) })}
                    </p>
                    <p className="text-sm break-words">{grant.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      to={`/matters/${grant.matterId}`}
                      aria-label={t("breakGlass.open", { reference: ltr(grant.reference) })}
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-muted"
                    >
                      {t("conflicts.open")}
                    </Link>
                    <Button
                      variant="outline"
                      className="text-danger"
                      aria-label={t("breakGlass.end", { reference: ltr(grant.reference) })}
                      disabled={end.isPending}
                      onClick={() => {
                        end.mutate(grant.id);
                      }}
                    >
                      {t("breakGlass.endShort")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>
    </section>
  );
}
