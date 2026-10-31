import {
  billingSettingsResponseSchema,
  updateBillingSettingsRequestSchema,
  type BillingSettings,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader, Section } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ReauthCancelled, useSensitiveAction } from "@/features/auth/reauth";
import { useErrorMessage } from "@/features/auth/use-error-message";
import {
  useBillingSettings,
  useBillingSummary,
  useInvalidateBilling,
  useMoney,
} from "@/features/billing/queries";
import { officeToday } from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";

type TextField = Exclude<
  keyof BillingSettings,
  "vatRateBasisPoints" | "paymentTermDays" | "missing" | "updatedAt"
>;

const TEXT_FIELDS: { key: TextField; multiline?: boolean; ltr?: boolean; max: number }[] = [
  { key: "officeName", max: 200 },
  { key: "address", multiline: true, max: 500 },
  { key: "barAssociation", max: 120 },
  { key: "phone", ltr: true, max: 32 },
  { key: "email", ltr: true, max: 254 },
  { key: "ice", ltr: true, max: 20 },
  { key: "taxId", ltr: true, max: 14 },
  { key: "professionalTaxId", ltr: true, max: 16 },
  { key: "bankName", max: 120 },
  { key: "rib", ltr: true, max: 32 },
  { key: "invoiceNote", multiline: true, max: 1000 },
];

/** Moroccan VAT rates. 20 % is the standard rate; the accountant confirms the one that applies. */
const VAT_RATES = [2000, 1400, 1000, 700, 0];

function SettingsForm({ settings }: { settings: BillingSettings }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const sensitive = useSensitiveAction();
  const invalidate = useInvalidateBilling();
  const { rate } = useMoney();
  const [values, setValues] = useState(
    () =>
      ({
        ...Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, settings[key] ?? ""])),
        vatRateBasisPoints: String(settings.vatRateBasisPoints),
        paymentTermDays: String(settings.paymentTermDays),
      }) as Record<TextField | "vatRateBasisPoints" | "paymentTermDays", string>,
  );
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: object) =>
      sensitive(() => send("PATCH", "/api/billing/settings", body, billingSettingsResponseSchema)),
    onSuccess: async () => {
      setSaved(true);
      await invalidate();
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSaved(false);
    const body = {
      ...Object.fromEntries(
        TEXT_FIELDS.map(({ key }) => [key, values[key].trim() === "" ? null : values[key]]),
      ),
      vatRateBasisPoints: Number(values.vatRateBasisPoints),
      paymentTermDays: Number(values.paymentTermDays),
    };
    const next = new Set(
      updateBillingSettingsRequestSchema
        .safeParse(body)
        .error?.issues.map((i) => i.path.join(".")) ?? [],
    );
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);

  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      {settings.missing.length > 0 && (
        <Alert tone="info" title={t("billingAdmin.missingTitle")}>
          {t("billingAdmin.missing", {
            fields: settings.missing.map((f) => t(`billingSettings.${f}`)).join(", "),
          })}
        </Alert>
      )}
      {save.isError && !(save.error instanceof ReauthCancelled) && (
        <Alert tone="danger">{errorMessage(save.error)}</Alert>
      )}
      {saved && <Alert tone="success">{t("common.saved")}</Alert>}
      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map(({ key, multiline, ltr, max }) => (
            <div key={key} className={multiline ? "sm:col-span-2" : undefined}>
              <Field
                label={t(`billingSettings.${key}`)}
                hint={t(`billingSettingsHints.${key}`, { defaultValue: "" }) || undefined}
                error={error(key)}
              >
                {(props) =>
                  multiline ? (
                    <Textarea
                      {...props}
                      rows={2}
                      maxLength={max}
                      value={values[key]}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [key]: e.target.value }));
                      }}
                    />
                  ) : (
                    <Input
                      {...props}
                      maxLength={max}
                      dir={ltr ? "ltr" : undefined}
                      inputMode={
                        key === "ice" ||
                        key === "taxId" ||
                        key === "professionalTaxId" ||
                        key === "rib"
                          ? "numeric"
                          : undefined
                      }
                      value={values[key]}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [key]: e.target.value }));
                      }}
                    />
                  )
                }
              </Field>
            </div>
          ))}
          <Field
            label={t("billingSettings.vatRateBasisPoints")}
            hint={t("billingSettingsHints.vatRateBasisPoints")}
            error={error("vatRateBasisPoints")}
          >
            {(props) => (
              <Select
                {...props}
                value={values.vatRateBasisPoints}
                onChange={(e) => {
                  setValues((v) => ({ ...v, vatRateBasisPoints: e.target.value }));
                }}
              >
                {VAT_RATES.map((r) => (
                  <option key={r} value={String(r)}>
                    {rate(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("billingSettings.paymentTermDays")} error={error("paymentTermDays")}>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={365}
                value={values.paymentTermDays}
                onChange={(e) => {
                  setValues((v) => ({ ...v, paymentTermDays: e.target.value }));
                }}
              />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={save.isPending}>
          {t("common.save")}
        </Button>
      </Card>
    </form>
  );
}

function Summary() {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const { money } = useMoney();
  const current = Number(officeToday().slice(0, 4));
  const [year, setYear] = useState(current);
  const summary = useBillingSummary(year);
  const monthName = new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA", {
    month: "long",
    timeZone: "UTC",
  });

  return (
    <Section title={t("billingAdmin.summaryTitle")}>
      <p className="text-sm text-muted">{t("billingAdmin.summaryHint")}</p>
      <div className="max-w-40">
        <Field label={t("billingAdmin.year")}>
          {(props) => (
            <Select
              {...props}
              value={String(year)}
              onChange={(e) => {
                setYear(Number(e.target.value));
              }}
            >
              {[current, current - 1, current - 2].map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {summary.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {summary.isError && <Alert tone="danger">{errorMessage(summary.error)}</Alert>}
      {summary.data && (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Card>
              <dt className="text-sm text-muted">{t("billingAdmin.outstanding")}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {money(summary.data.summary.outstandingCentimes)}
              </dd>
            </Card>
            <Card>
              <dt className="text-sm text-muted">{t("billingAdmin.overdue")}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {summary.data.summary.overdueCount}
              </dd>
            </Card>
          </dl>
          <Card className="p-0 sm:p-0">
            {/* Scrolls sideways on phones: focusable and named so keyboards can scroll it too. */}
            <div
              role="region"
              aria-label={t("billingAdmin.summaryTable")}
              tabIndex={0}
              className="relative overflow-x-auto rounded-xl"
            >
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">{t("billingAdmin.summaryTitle")}</caption>
                <thead className="border-b border-border text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start font-medium">
                      {t("billingAdmin.month")}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">
                      {t("billingAdmin.count")}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">
                      {t("billingAdmin.invoiced")}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">
                      {t("billingAdmin.credited")}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">
                      {t("billingAdmin.received")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.data.summary.months.map((m) => (
                    <tr key={m.month}>
                      <th scope="row" className="px-4 py-2 text-start font-normal">
                        {monthName.format(new Date(Date.UTC(year, m.month - 1, 1)))}
                      </th>
                      <td className="px-4 py-2 text-end tabular-nums">{m.invoiceCount}</td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {money(m.invoicedCentimes)}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {money(m.creditedCentimes)}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {money(m.receivedCentimes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Section>
  );
}

/** Administrators: the office details printed on invoices, and office-wide totals (no names). */
export function BillingAdminPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const settings = useBillingSettings();
  return (
    <div className="space-y-10">
      <PageHeader title={t("billingAdmin.title")} description={t("billingAdmin.description")} />
      <Section title={t("billingAdmin.settingsTitle")}>
        {settings.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {settings.isError && <Alert tone="danger">{errorMessage(settings.error)}</Alert>}
        {settings.data && <SettingsForm settings={settings.data.settings} />}
      </Section>
      <Summary />
    </div>
  );
}
