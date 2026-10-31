import {
  createFeeAgreementRequestSchema,
  feeAgreementKinds,
  feeAgreementResponseSchema,
  invoiceResponseSchema,
  updateFeeAgreementRequestSchema,
  type FeeAgreement,
  type FeeAgreementKind,
  type MatterDetail,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { FilePlus2, Pencil, Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { invalidFields, useFormat } from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";
import { InvoiceStateBadges } from "./invoice-ui";
import {
  hundredthsToInput,
  invoicePath,
  parseHundredths,
  useFeeAgreements,
  useInvalidateBilling,
  useMatterInvoices,
  useMoney,
} from "./queries";

interface AgreementValues {
  kind: FeeAgreementKind;
  title: string;
  amount: string;
  hourlyRate: string;
  signedOn: string;
  endedOn: string;
  terms: string;
}

const centimesInput = (value: number | null) => (value === null ? "" : hundredthsToInput(value));

function AgreementDialog({
  matterId,
  agreement,
  onClose,
}: {
  matterId: string;
  agreement: FeeAgreement | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateBilling();
  const [values, setValues] = useState<AgreementValues>({
    kind: agreement?.kind ?? "fixed",
    title: agreement?.title ?? "",
    amount: centimesInput(agreement?.amountCentimes ?? null),
    hourlyRate: centimesInput(agreement?.hourlyRateCentimes ?? null),
    signedOn: agreement?.signedOn ?? "",
    endedOn: agreement?.endedOn ?? "",
    terms: agreement?.terms ?? "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof AgreementValues>(key: K, value: AgreementValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };
  const base = `/api/matters/${matterId}/fee-agreements` as const;

  const save = useMutation({
    mutationFn: (body: object) =>
      agreement
        ? send("PATCH", `${base}/${agreement.id}`, body, feeAgreementResponseSchema)
        : send("POST", base, body, feeAgreementResponseSchema),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const next = new Set<string>();
    const amount = (text: string, key: string) => {
      if (text.trim() === "") return null;
      const value = parseHundredths(text);
      if (value === null) next.add(key);
      return value;
    };
    const common = {
      title: values.title,
      amountCentimes: amount(values.amount, "amountCentimes"),
      hourlyRateCentimes: amount(values.hourlyRate, "hourlyRateCentimes"),
      signedOn: values.signedOn === "" ? null : values.signedOn,
      terms: values.terms.trim() === "" ? null : values.terms,
    };
    const body = agreement
      ? { ...common, endedOn: values.endedOn === "" ? null : values.endedOn }
      : { kind: values.kind, ...common };
    const schema = agreement ? updateFeeAgreementRequestSchema : createFeeAgreementRequestSchema;
    for (const field of invalidFields(schema.safeParse(body).error)) next.add(field);
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optionalLabel = (label: string) => t("common.optional", { label });
  const kind = agreement?.kind ?? values.kind;

  return (
    <Dialog
      open
      onClose={onClose}
      title={agreement ? t("feeAgreements.editTitle") : t("feeAgreements.addTitle")}
    >
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {!agreement && (
          <Field label={t("feeAgreements.kind")}>
            {(props) => (
              <Select
                {...props}
                value={values.kind}
                onChange={(e) => {
                  set("kind", e.target.value as FeeAgreementKind);
                }}
              >
                {feeAgreementKinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`feeAgreementKinds.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("feeAgreements.titleLabel")} error={error("title")}>
          {(props) => (
            <Input
              {...props}
              maxLength={200}
              value={values.title}
              onChange={(e) => {
                set("title", e.target.value);
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              kind === "fixed"
                ? t("feeAgreements.amount")
                : optionalLabel(t("feeAgreements.amount"))
            }
            hint={t("billing.amountHint")}
            error={error("amountCentimes")}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                dir="ltr"
                value={values.amount}
                onChange={(e) => {
                  set("amount", e.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label={
              kind === "hourly"
                ? t("feeAgreements.hourlyRate")
                : optionalLabel(t("feeAgreements.hourlyRate"))
            }
            hint={t("billing.amountHint")}
            error={error("hourlyRateCentimes")}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                dir="ltr"
                value={values.hourlyRate}
                onChange={(e) => {
                  set("hourlyRate", e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={optionalLabel(t("feeAgreements.signedOn"))} error={error("signedOn")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={values.signedOn}
                onChange={(e) => {
                  set("signedOn", e.target.value);
                }}
              />
            )}
          </Field>
          {agreement && (
            <Field
              label={optionalLabel(t("feeAgreements.endedOn"))}
              hint={t("feeAgreements.endedOnHint")}
              error={error("endedOn")}
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={values.endedOn}
                  onChange={(e) => {
                    set("endedOn", e.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </div>
        <Field label={optionalLabel(t("feeAgreements.terms"))} error={error("terms")}>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              maxLength={4000}
              value={values.terms}
              onChange={(e) => {
                set("terms", e.target.value);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FeeAgreements({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const { money } = useMoney();
  const agreements = useFeeAgreements(matter.id);
  const [editing, setEditing] = useState<FeeAgreement | "new" | null>(null);
  const { manageBilling } = matter.permissions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("feeAgreements.title")}</h3>
        {manageBilling && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("feeAgreements.add")}
          </Button>
        )}
      </div>
      {agreements.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {agreements.isError && <Alert tone="danger">{errorMessage(agreements.error)}</Alert>}
      {agreements.data?.feeAgreements.length === 0 && (
        <p className="text-sm text-muted">{t("feeAgreements.empty")}</p>
      )}
      {agreements.data && agreements.data.feeAgreements.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {agreements.data.feeAgreements.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{a.title}</span>
                    <Badge>{t(`feeAgreementKinds.${a.kind}`)}</Badge>
                    {a.endedOn && (
                      <Badge>{t("feeAgreements.ended", { date: format.date(a.endedOn) })}</Badge>
                    )}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                    {a.amountCentimes !== null && <span>{money(a.amountCentimes)}</span>}
                    {a.hourlyRateCentimes !== null && (
                      <span>
                        {t("feeAgreements.perHour", { amount: money(a.hourlyRateCentimes) })}
                      </span>
                    )}
                    {a.signedOn && (
                      <span>{t("feeAgreements.signed", { date: format.date(a.signedOn) })}</span>
                    )}
                  </p>
                  {a.terms && <p className="text-sm break-words whitespace-pre-line">{a.terms}</p>}
                </div>
                {manageBilling && (
                  <Button
                    variant="outline"
                    className="shrink-0"
                    aria-label={t("feeAgreements.edit", { title: a.title })}
                    onClick={() => {
                      setEditing(a);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t("common.edit")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <AgreementDialog
          matterId={matter.id}
          agreement={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function MatterInvoices({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const format = useFormat();
  const { money } = useMoney();
  const invoices = useMatterInvoices(matter.id);
  const invalidate = useInvalidateBilling();

  const create = useMutation({
    mutationFn: () =>
      send("POST", `/api/matters/${matter.id}/invoices`, { lines: [] }, invoiceResponseSchema),
    onSuccess: async ({ invoice }) => {
      await invalidate();
      await navigate(invoicePath(matter.id, invoice.id));
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("invoices.title")}</h3>
        {matter.permissions.draftInvoices && (
          <Button
            variant="outline"
            disabled={create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            {t("invoices.new")}
          </Button>
        )}
      </div>
      {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      {invoices.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {invoices.isError && <Alert tone="danger">{errorMessage(invoices.error)}</Alert>}
      {invoices.data?.invoices.length === 0 && (
        <p className="text-sm text-muted">{t("invoices.empty")}</p>
      )}
      {invoices.data && invoices.data.invoices.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {invoices.data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  to={invoicePath(matter.id, invoice.id)}
                  className="flex flex-col gap-1 p-4 hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {t(`invoiceKinds.${invoice.kind}`)}{" "}
                      <bdi dir="ltr" className="font-mono">
                        {invoice.number ?? t("invoices.draftNumber")}
                      </bdi>
                    </span>
                    <InvoiceStateBadges invoice={invoice} />
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-sm text-muted">
                    {invoice.issuedOn && <span>{format.date(invoice.issuedOn)}</span>}
                    <span className="font-medium text-ink">{money(invoice.totalCentimes)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Fee agreements and invoices of a matter, for its team (never under break-glass access). */
export function BillingSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  if (!matter.permissions.readBilling) return null;
  return (
    <Section title={t("billing.title")}>
      <div className="space-y-8">
        <FeeAgreements matter={matter} />
        <MatterInvoices matter={matter} />
      </div>
    </Section>
  );
}
