import { EXPORT_MAX_DAYS, invoiceViews, type InvoiceView } from "@lexora/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { Alert, Card, PageHeader, Section } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useSession } from "@/features/auth/session";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { Pagination } from "@/features/matters/matter-ui";
import { officeToday, useFormat } from "@/features/matters/queries";
import { InvoiceStateBadges } from "./invoice-ui";
import { invoicePath, useInvoiceList, useMoney } from "./queries";

/** Lawyers download the sales journal (CSV) of their own matters for a period. */
function ExportForm() {
  const { t } = useTranslation();
  const today = officeToday();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const valid = from !== "" && to !== "" && days >= 0 && days < EXPORT_MAX_DAYS;

  return (
    <Section title={t("invoicesPage.exportTitle")}>
      <Card className="space-y-4">
        <p className="text-sm text-muted">{t("invoicesPage.exportHint")}</p>
        <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
          <Field label={t("invoicesPage.from")}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label={t("invoicesPage.to")}
            error={valid ? undefined : t("invoicesPage.rangeInvalid")}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                }}
              />
            )}
          </Field>
          {valid ? (
            <a
              href={`/api/invoices/export?from=${from}&to=${to}`}
              download
              className={buttonVariants()}
            >
              <Download className="size-4" aria-hidden="true" />
              {t("invoicesPage.download")}
            </a>
          ) : (
            <span aria-disabled="true" className={buttonVariants({ className: "opacity-50" })}>
              <Download className="size-4" aria-hidden="true" />
              {t("invoicesPage.download")}
            </span>
          )}
        </div>
      </Card>
    </Section>
  );
}

export function InvoicesPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const { money } = useMoney();
  const role = useSession().data?.user.role;
  const [view, setView] = useState<InvoiceView>("all");
  const [page, setPage] = useState(1);
  const list = useInvoiceList(view, page);

  return (
    <div className="space-y-8">
      <PageHeader title={t("invoicesPage.title")} description={t("invoicesPage.description")} />
      <div className="max-w-xs">
        <Field label={t("invoicesPage.view")}>
          {(props) => (
            <Select
              {...props}
              value={view}
              onChange={(e) => {
                setView(e.target.value as InvoiceView);
                setPage(1);
              }}
            >
              {invoiceViews.map((v) => (
                <option key={v} value={v}>
                  {t(`invoiceViews.${v}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {list.isPending && <p className="text-muted">{t("common.loading")}</p>}
      {list.isError && <Alert tone="danger">{errorMessage(list.error)}</Alert>}
      {list.data?.invoices.length === 0 && <p className="text-muted">{t("invoicesPage.empty")}</p>}
      {list.data && list.data.invoices.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {list.data.invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  to={invoicePath(invoice.matter.id, invoice.id)}
                  className="flex flex-col gap-2 p-4 hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <span>
                        {t(`invoiceKinds.${invoice.kind}`)}{" "}
                        <bdi dir="ltr" className="font-mono">
                          {invoice.number ?? t("invoices.draftNumber")}
                        </bdi>
                      </span>
                      <InvoiceStateBadges invoice={invoice} />
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-sm text-muted">
                      <span>{invoice.clientName}</span>
                      <bdi dir="ltr" className="font-mono">
                        {invoice.matter.reference}
                      </bdi>
                      {invoice.issuedOn && <span>{format.date(invoice.issuedOn)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm sm:text-end">
                    <span className="block font-medium">{money(invoice.totalCentimes)}</span>
                    {invoice.paymentState && invoice.paymentState !== "paid" && (
                      <span className="block text-muted">
                        {invoice.balanceCentimes < 0
                          ? t("invoicesPage.overpaid", { amount: money(-invoice.balanceCentimes) })
                          : t("invoicesPage.balance", { amount: money(invoice.balanceCentimes) })}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list.data && (
        <Pagination page={list.data.page} hasMore={list.data.hasMore} onPage={setPage} />
      )}
      {role === "lawyer" && <ExportForm />}
    </div>
  );
}
