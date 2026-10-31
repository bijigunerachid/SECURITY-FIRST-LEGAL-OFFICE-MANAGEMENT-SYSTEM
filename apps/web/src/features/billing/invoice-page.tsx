import {
  MAX_INVOICE_LINES,
  invoiceResponseSchema,
  lineKinds,
  paymentMethods,
  recordPaymentRequestSchema,
  updateInvoiceRequestSchema,
  type InvoiceDetail,
  type LineKind,
  type Payment,
  type PaymentKind,
  type PaymentMethod,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { Ban, FileMinus2, Plus, Printer, Send, Trash2, Wallet, X } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { ConfirmDialog, NotFoundNotice } from "@/features/matters/matter-ui";
import { invalidFields, officeToday, useFormat, useMatter } from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";
import { ltr } from "@/lib/utils";
import { InvoiceDocument, InvoiceStateBadges } from "./invoice-ui";
import {
  hundredthsToInput,
  invoicePath,
  parseHundredths,
  useBillingSettings,
  useInvalidateBilling,
  useInvoice,
  useMoney,
} from "./queries";

interface LineValues {
  key: number;
  kind: LineKind;
  description: string;
  quantity: string;
  unitPrice: string;
}

let nextKey = 0;
const newLine = (kind: LineKind = "fee"): LineValues => ({
  key: (nextKey += 1),
  kind,
  description: "",
  quantity: "1",
  unitPrice: "",
});

/** Lines and notes of a draft. Totals are recomputed by the server on save. */
function DraftEditor({ invoice, matterId }: { invoice: InvoiceDetail; matterId: string }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateBilling();
  const [lines, setLines] = useState<LineValues[]>(() =>
    invoice.lines.length === 0
      ? [newLine()]
      : invoice.lines.map((l) => ({
          key: (nextKey += 1),
          kind: l.kind,
          description: l.description,
          quantity: hundredthsToInput(l.quantityHundredths),
          unitPrice: hundredthsToInput(l.unitPriceCentimes),
        })),
  );
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const credit = invoice.kind === "credit_note";

  const save = useMutation({
    mutationFn: (body: object) =>
      send("PATCH", `/api/matters/${matterId}/invoices/${invoice.id}`, body, invoiceResponseSchema),
    onSuccess: async () => {
      setSaved(true);
      await invalidate();
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const update = (key: number, changes: Partial<LineValues>) => {
    setSaved(false);
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...changes } : l)));
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const next = new Set<string>();
    const body = {
      notes: notes.trim() === "" ? null : notes,
      lines: lines.map((line, i) => {
        const quantityHundredths = parseHundredths(line.quantity);
        const unitPriceCentimes = parseHundredths(line.unitPrice);
        if (quantityHundredths === null) next.add(`lines.${String(i)}.quantityHundredths`);
        if (unitPriceCentimes === null) next.add(`lines.${String(i)}.unitPriceCentimes`);
        return {
          kind: line.kind,
          description: line.description,
          quantityHundredths: quantityHundredths ?? 0,
          unitPriceCentimes: unitPriceCentimes ?? 0,
        };
      }),
    };
    for (const field of invalidFields(updateInvoiceRequestSchema.safeParse(body).error))
      next.add(field);
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);

  return (
    <Section title={credit ? t("invoicePage.editCreditNote") : t("invoicePage.editLines")}>
      <form noValidate className="space-y-4 print:hidden" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {saved && !save.isPending && <Alert tone="success">{t("invoicePage.saved")}</Alert>}
        <p className="text-sm text-muted">{t("invoicePage.linesHint")}</p>
        <ol className="space-y-3">
          {lines.map((line, i) => (
            <li key={line.key}>
              <Card className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {t("invoicePage.lineNumber", { number: i + 1 })}
                  </p>
                  <Button
                    variant="ghost"
                    aria-label={t("invoicePage.removeLine", { number: i + 1 })}
                    onClick={() => {
                      setSaved(false);
                      setLines((all) => all.filter((l) => l.key !== line.key));
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <Field label={t("invoicePage.lineKind")}>
                      {(props) => (
                        <Select
                          {...props}
                          value={line.kind}
                          onChange={(e) => {
                            update(line.key, { kind: e.target.value as LineKind });
                          }}
                        >
                          {lineKinds.map((k) => (
                            <option key={k} value={k}>
                              {t(`lineKinds.${k}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-4">
                    <Field
                      label={t("invoicePage.description")}
                      error={error(`lines.${String(i)}.description`)}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          maxLength={500}
                          value={line.description}
                          onChange={(e) => {
                            update(line.key, { description: e.target.value });
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field
                      label={t("invoicePage.quantity")}
                      error={error(`lines.${String(i)}.quantityHundredths`)}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          inputMode="decimal"
                          dir="ltr"
                          value={line.quantity}
                          onChange={(e) => {
                            update(line.key, { quantity: e.target.value });
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-4">
                    <Field
                      label={t("invoicePage.unitPrice")}
                      hint={t("billing.amountHint")}
                      error={error(`lines.${String(i)}.unitPriceCentimes`)}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          inputMode="decimal"
                          dir="ltr"
                          value={line.unitPrice}
                          onChange={(e) => {
                            update(line.key, { unitPrice: e.target.value });
                          }}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
        {invalid.has("lines") && <Alert tone="danger">{t("invoicePage.linesInvalid")}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={lines.length >= MAX_INVOICE_LINES}
            onClick={() => {
              setSaved(false);
              setLines((all) => [...all, newLine()]);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("invoicePage.addLine")}
          </Button>
          <Button
            variant="outline"
            disabled={lines.length >= MAX_INVOICE_LINES}
            onClick={() => {
              setSaved(false);
              setLines((all) => [...all, newLine("disbursement")]);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("invoicePage.addDisbursement")}
          </Button>
        </div>
        <Field
          label={t("common.optional", { label: t("invoicePage.notes") })}
          error={error("notes")}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => {
                setSaved(false);
                setNotes(e.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t("invoicePage.saveDraft")}
        </Button>
      </form>
    </Section>
  );
}

function PaymentDialog({
  invoice,
  matterId,
  onClose,
}: {
  invoice: InvoiceDetail;
  matterId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateBilling();
  const { money } = useMoney();
  const overpaid = invoice.balanceCentimes < 0;
  const kind: PaymentKind = overpaid ? "refund" : "payment";
  const limit = Math.abs(invoice.balanceCentimes);
  const [values, setValues] = useState({
    receivedOn: officeToday(),
    amount: hundredthsToInput(limit),
    method: "transfer" as PaymentMethod,
    reference: "",
    notes: "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (body: object) =>
      send(
        "POST",
        `/api/matters/${matterId}/invoices/${invoice.id}/payments`,
        body,
        invoiceResponseSchema,
      ),
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
    const amountCentimes = parseHundredths(values.amount);
    const body = {
      kind,
      receivedOn: values.receivedOn,
      amountCentimes: amountCentimes ?? 0,
      method: values.method,
      reference: values.reference.trim() === "" ? null : values.reference,
      notes: values.notes.trim() === "" ? null : values.notes,
    };
    const next = invalidFields(recordPaymentRequestSchema.safeParse(body).error);
    if (amountCentimes === null || amountCentimes > limit) next.add("amountCentimes");
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optionalLabel = (label: string) => t("common.optional", { label });

  return (
    <Dialog
      open
      onClose={onClose}
      title={overpaid ? t("payments.refundTitle") : t("payments.recordTitle")}
    >
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <p className="text-sm">
          {overpaid
            ? t("payments.overpaidBy", { amount: money(limit) })
            : t("payments.due", { amount: money(limit) })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("payments.amount")}
            error={error("amountCentimes")}
            hint={t("billing.amountHint")}
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
          <Field label={t("payments.receivedOn")} error={error("receivedOn")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                min={invoice.issuedOn ?? undefined}
                max={officeToday()}
                value={values.receivedOn}
                onChange={(e) => {
                  set("receivedOn", e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t("payments.method")}>
            {(props) => (
              <Select
                {...props}
                value={values.method}
                onChange={(e) => {
                  set("method", e.target.value as PaymentMethod);
                }}
              >
                {paymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {t(`paymentMethods.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={optionalLabel(t("payments.reference"))}
            hint={t("payments.referenceHint")}
            error={error("reference")}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={100}
                value={values.reference}
                onChange={(e) => {
                  set("reference", e.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Field label={optionalLabel(t("payments.notes"))} error={error("notes")}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={500}
              value={values.notes}
              onChange={(e) => {
                set("notes", e.target.value);
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

function VoidDialog({
  payment,
  invoiceId,
  matterId,
  onClose,
}: {
  payment: Payment;
  invoiceId: string;
  matterId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateBilling();
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      send(
        "POST",
        `/api/matters/${matterId}/invoices/${invoiceId}/payments/${payment.id}/void`,
        { reason },
        invoiceResponseSchema,
      ),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t("payments.voidTitle")}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const short = reason.trim().length < 5;
          setInvalid(short);
          if (!short) save.mutate();
        }}
      >
        {save.isError && (
          <Alert tone="danger">
            {isApiError(save.error, "conflict")
              ? t("payments.voidRefundFirst")
              : errorMessage(save.error)}
          </Alert>
        )}
        <p className="text-sm">{t("payments.voidExplain")}</p>
        <Field
          label={t("payments.voidReason")}
          hint={t("payments.voidReasonHint")}
          error={invalid ? t("form.invalid") : undefined}
        >
          {(props) => (
            <Input
              {...props}
              maxLength={300}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("payments.void")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Payments({ invoice, matterId }: { invoice: InvoiceDetail; matterId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { money } = useMoney();
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const can = invoice.permissions.recordPayment;
  const settled = invoice.balanceCentimes === 0;

  return (
    <Section
      title={t("payments.title")}
      actions={
        can &&
        !settled && (
          <Button
            variant="outline"
            className="print:hidden"
            onClick={() => {
              setRecording(true);
            }}
          >
            <Wallet className="size-4" aria-hidden="true" />
            {invoice.balanceCentimes < 0 ? t("payments.refund") : t("payments.record")}
          </Button>
        )
      }
    >
      {invoice.payments.length === 0 ? (
        <p className="text-sm text-muted">{t("payments.empty")}</p>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {invoice.payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className={p.voidedAt ? "text-muted line-through" : undefined}>
                      {/* Intl places the sign correctly in both directions. */}
                      {money(p.kind === "refund" ? -p.amountCentimes : p.amountCentimes)}
                    </span>
                    <Badge>{t(`paymentMethods.${p.method}`)}</Badge>
                    {p.kind === "refund" && <Badge>{t("payments.refundBadge")}</Badge>}
                    {p.voidedAt && <Badge tone="danger">{t("payments.voided")}</Badge>}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>{format.date(p.receivedOn)}</span>
                    {p.reference && <span dir="auto">{p.reference}</span>}
                    <span>{t("payments.recordedBy", { name: p.recordedBy.displayName })}</span>
                  </p>
                  {p.notes && <p className="text-sm break-words whitespace-pre-line">{p.notes}</p>}
                  {p.voidReason && p.voidedBy && (
                    <p className="text-sm text-danger">
                      {t("payments.voidedBecause", {
                        name: p.voidedBy.displayName,
                        reason: p.voidReason,
                      })}
                    </p>
                  )}
                </div>
                {can && !p.voidedAt && (
                  <Button
                    variant="outline"
                    className="shrink-0 text-danger print:hidden"
                    aria-label={t("payments.voidNamed", { amount: money(p.amountCentimes) })}
                    onClick={() => {
                      setVoiding(p);
                    }}
                  >
                    <Ban className="size-4" aria-hidden="true" />
                    {t("payments.void")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {recording && (
        <PaymentDialog
          invoice={invoice}
          matterId={matterId}
          onClose={() => {
            setRecording(false);
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          payment={voiding}
          invoiceId={invoice.id}
          matterId={matterId}
          onClose={() => {
            setVoiding(null);
          }}
        />
      )}
    </Section>
  );
}

function CreditNotes({ invoice, matterId }: { invoice: InvoiceDetail; matterId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { money } = useMoney();
  if (invoice.creditNotes.length === 0) return null;
  return (
    <Section title={t("invoicePage.creditNotes")}>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {invoice.creditNotes.map((c) => (
            <li key={c.id}>
              <Link
                to={invoicePath(matterId, c.id)}
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-surface-muted sm:px-6"
              >
                <span className="flex items-center gap-2 font-medium">
                  <bdi dir="ltr" className="font-mono">
                    {c.number ?? t("invoices.draftNumber")}
                  </bdi>
                  {c.status === "draft" && <Badge>{t("invoiceStatuses.draft")}</Badge>}
                </span>
                <span className="text-sm text-muted">
                  {c.issuedOn && `${format.date(c.issuedOn)} · `}
                  {money(c.totalCentimes)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export function InvoicePage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const { matterId = "", invoiceId = "" } = useParams();
  const matter = useMatter(matterId);
  const query = useInvoice(matterId, invoiceId);
  const settings = useBillingSettings();
  const invalidate = useInvalidateBilling();
  const [confirm, setConfirm] = useState<"issue" | "delete" | "credit" | null>(null);

  const action = useMutation({
    mutationFn: async (kind: "issue" | "delete" | "credit") => {
      const base = `/api/matters/${matterId}/invoices/${invoiceId}` as const;
      if (kind === "delete") {
        await send("DELETE", base);
        return null;
      }
      return send(
        "POST",
        kind === "issue" ? `${base}/issue` : `${base}/credit-note`,
        undefined,
        invoiceResponseSchema,
      );
    },
    onSuccess: async (result, kind) => {
      setConfirm(null);
      await invalidate();
      if (kind === "delete") await navigate(`/matters/${matterId}`);
      if (kind === "credit" && result) await navigate(invoicePath(matterId, result.invoice.id));
    },
  });

  if (query.isPending || matter.isPending) {
    return <p className="text-muted">{t("common.loading")}</p>;
  }
  if (isApiError(query.error, "not_found") || isApiError(matter.error, "not_found")) {
    return (
      <NotFoundNotice
        title={t("invoicePage.notFoundTitle")}
        body={t("invoicePage.notFoundBody")}
        backTo="/invoices"
        backLabel={t("invoicePage.backToInvoices")}
      />
    );
  }
  if (query.isError || matter.isError) {
    return <Alert tone="danger">{errorMessage(query.error ?? matter.error)}</Alert>;
  }

  const { invoice } = query.data;
  const draft = invoice.status === "draft";
  const credit = invoice.kind === "credit_note";
  const missing = settings.data?.settings.missing ?? [];
  const title = draft
    ? t(credit ? "invoicePage.draftCreditNote" : "invoicePage.draftInvoice")
    : t(credit ? "invoicePage.creditNoteNumber" : "invoicePage.invoiceNumber", {
        number: ltr(invoice.number ?? ""),
      });
  const confirmText = {
    issue: { title: t("invoicePage.issueTitle"), message: t("invoicePage.issueConfirm") },
    delete: { title: t("invoicePage.deleteTitle"), message: t("invoicePage.deleteConfirm") },
    credit: { title: t("invoicePage.creditTitle"), message: t("invoicePage.creditConfirm") },
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2 print:hidden">
        <Link
          to={`/matters/${matterId}`}
          className="inline-flex min-h-11 items-center text-sm text-muted underline decoration-accent decoration-2 underline-offset-4"
        >
          {t("invoicePage.backToMatter", {
            reference: ltr(matter.data.matter.reference),
            title: matter.data.matter.title,
          })}
        </Link>
        <h1
          id="page-title"
          className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight"
        >
          <span>{title}</span>
          <InvoiceStateBadges invoice={invoice} />
        </h1>
      </header>

      <div className="flex flex-wrap gap-2 print:hidden">
        {invoice.status === "issued" && (
          <Button
            variant="outline"
            onClick={() => {
              window.print();
            }}
          >
            <Printer className="size-4" aria-hidden="true" />
            {t("invoicePage.print")}
          </Button>
        )}
        {invoice.permissions.issue && (
          <Button
            disabled={missing.length > 0 || invoice.totalCentimes <= 0}
            onClick={() => {
              setConfirm("issue");
            }}
          >
            <Send className="size-4" aria-hidden="true" />
            {credit ? t("invoicePage.issueCreditNote") : t("invoicePage.issue")}
          </Button>
        )}
        {invoice.permissions.creditNote && (
          <Button
            variant="outline"
            onClick={() => {
              setConfirm("credit");
            }}
          >
            <FileMinus2 className="size-4" aria-hidden="true" />
            {t("invoicePage.createCreditNote")}
          </Button>
        )}
        {invoice.permissions.delete && (
          <Button
            variant="outline"
            className="text-danger"
            onClick={() => {
              setConfirm("delete");
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("invoicePage.deleteDraft")}
          </Button>
        )}
      </div>
      {draft && invoice.permissions.issue && missing.length > 0 && (
        <div className="print:hidden">
          <Alert tone="info" title={t("invoicePage.detailsMissingTitle")}>
            {t("invoicePage.detailsMissing", {
              fields: missing.map((f) => t(`billingSettings.${f}`)).join(", "),
            })}
          </Alert>
        </div>
      )}
      {draft && !invoice.permissions.issue && (
        <div className="print:hidden">
          <Alert tone="info">{t("invoicePage.lawyerIssues")}</Alert>
        </div>
      )}

      <InvoiceDocument invoice={invoice} settings={settings.data?.settings} />

      {draft && invoice.permissions.edit && (
        <DraftEditor key={invoice.id} invoice={invoice} matterId={matterId} />
      )}
      {invoice.kind === "invoice" && invoice.status === "issued" && (
        <div className="space-y-8 print:hidden">
          <Payments invoice={invoice} matterId={matterId} />
          <CreditNotes invoice={invoice} matterId={matterId} />
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          open
          title={confirmText[confirm].title}
          message={confirmText[confirm].message}
          error={
            action.isError
              ? isApiError(action.error, "validation_failed")
                ? t(credit ? "invoicePage.creditTooMuch" : "invoicePage.nothingToIssue")
                : errorMessage(action.error)
              : null
          }
          pending={action.isPending}
          onConfirm={() => {
            action.mutate(confirm);
          }}
          onClose={() => {
            setConfirm(null);
            action.reset();
          }}
        />
      )}
    </div>
  );
}
