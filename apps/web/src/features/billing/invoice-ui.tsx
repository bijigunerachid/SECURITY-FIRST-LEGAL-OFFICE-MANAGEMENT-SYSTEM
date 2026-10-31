import type { BillingSettings, InvoiceDetail, InvoiceSummary } from "@lexora/shared";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/feedback";
import { useFormat } from "@/features/matters/queries";
import { useMoney } from "./queries";

/** Draft or issued, then how much is paid and whether it is late. */
export function InvoiceStateBadges({ invoice }: { invoice: InvoiceSummary }) {
  const { t } = useTranslation();
  if (invoice.status === "draft") return <Badge>{t("invoiceStatuses.draft")}</Badge>;
  return (
    <>
      {invoice.paymentState && (
        <Badge tone={invoice.paymentState === "paid" ? "success" : "neutral"}>
          {t(`paymentStates.${invoice.paymentState}`)}
        </Badge>
      )}
      {invoice.overdue && <Badge tone="danger">{t("invoices.overdue")}</Badge>}
    </>
  );
}

function Lines({ label, lines }: { label: string; lines: (string | null | undefined)[] }) {
  const present = lines.filter((l): l is string => Boolean(l));
  return (
    <div className="space-y-0.5 text-sm">
      <p className="text-xs font-medium text-muted">{label}</p>
      {present.map((line, i) => (
        // Names and addresses may be French inside Arabic text: each line takes its own direction.
        <p key={i} dir="auto" className="break-words whitespace-pre-line">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The invoice as printed. An issued invoice shows the office and client
 * details frozen when it was issued; a draft shows today's office details
 * and is marked as a draft.
 */
export function InvoiceDocument({
  invoice,
  settings,
}: {
  invoice: InvoiceDetail;
  settings: BillingSettings | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { money, quantity, rate } = useMoney();
  const seller = invoice.seller ?? settings;
  const credit = invoice.kind === "credit_note";
  const label = (key: string, values: Record<string, string> = {}) =>
    t(`invoiceDocument.${key}`, values);

  return (
    <article
      aria-label={t(`invoiceKinds.${invoice.kind}`)}
      className="space-y-6 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
        <img src="/logo-wordmark.png" alt="Lexora" className="h-10 w-auto self-start sm:h-12" />
        <div className="space-y-1 sm:text-end print:text-end">
          <p className="text-xl font-semibold">
            {t(`invoiceKinds.${invoice.kind}`)}{" "}
            <bdi dir="ltr" className="font-mono">
              {invoice.number ?? label("draft")}
            </bdi>
          </p>
          {invoice.issuedOn && (
            <p className="text-sm">{label("issuedOn", { date: format.date(invoice.issuedOn) })}</p>
          )}
          {invoice.dueOn && (
            <p className="text-sm">{label("dueOn", { date: format.date(invoice.dueOn) })}</p>
          )}
          {invoice.creditedInvoice && (
            <p className="text-sm">
              {label("corrects")}{" "}
              <bdi dir="ltr" className="font-mono">
                {invoice.creditedInvoice.number}
              </bdi>
            </p>
          )}
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
        <Lines
          label={label("from")}
          lines={[
            seller?.officeName,
            seller?.address,
            seller?.barAssociation ? label("bar", { name: seller.barAssociation }) : null,
            seller?.phone,
            seller?.email,
            seller?.ice ? label("ice", { value: seller.ice }) : null,
            seller?.taxId ? label("taxId", { value: seller.taxId }) : null,
            seller?.professionalTaxId
              ? label("professionalTaxId", { value: seller.professionalTaxId })
              : null,
          ]}
        />
        <Lines
          label={label("to")}
          lines={[
            invoice.buyer?.name ?? invoice.clientName,
            invoice.buyer?.address,
            invoice.buyer?.identifier
              ? label("identifier", { value: invoice.buyer.identifier })
              : null,
          ]}
        />
      </div>

      {invoice.lines.length === 0 ? (
        <p className="text-sm text-muted">{label("noLines")}</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{label("lines")}</caption>
          <thead className="border-b border-border text-start text-xs text-muted">
            <tr>
              <th scope="col" className="py-2 text-start font-medium">
                {label("description")}
              </th>
              <th
                scope="col"
                className="hidden py-2 text-end font-medium sm:table-cell print:table-cell"
              >
                {label("quantity")}
              </th>
              <th
                scope="col"
                className="hidden py-2 text-end font-medium sm:table-cell print:table-cell"
              >
                {label("unitPrice")}
              </th>
              <th
                scope="col"
                className="hidden py-2 text-end font-medium sm:table-cell print:table-cell"
              >
                {label("vat")}
              </th>
              <th scope="col" className="py-2 text-end font-medium">
                {label("net")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoice.lines.map((line, i) => (
              <tr key={i} className="align-top">
                <td className="py-2 pe-3">
                  <p dir="auto" className="break-words">
                    {line.description}
                  </p>
                  <p className="text-xs text-muted">
                    {t(`lineKinds.${line.kind}`)}
                    {/* On phones the detail columns are hidden: repeat them here. */}
                    <span className="sm:hidden print:hidden">
                      {" · "}
                      {quantity(line.quantityHundredths)} × {money(line.unitPriceCentimes)}
                    </span>
                  </p>
                </td>
                <td className="hidden py-2 text-end tabular-nums sm:table-cell print:table-cell">
                  {quantity(line.quantityHundredths)}
                </td>
                <td className="hidden py-2 text-end tabular-nums sm:table-cell print:table-cell">
                  {money(line.unitPriceCentimes)}
                </td>
                <td className="hidden py-2 text-end tabular-nums sm:table-cell print:table-cell">
                  {rate(line.vatRateBasisPoints)}
                </td>
                <td className="py-2 text-end whitespace-nowrap tabular-nums">
                  {money(line.netCentimes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="ms-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt>{label("subtotal")}</dt>
          <dd className="tabular-nums">{money(invoice.subtotalCentimes)}</dd>
        </div>
        {invoice.vatBreakdown.map((row) => (
          <div key={row.rateBasisPoints} className="flex justify-between gap-4">
            <dt>
              {label("vatAt", { rate: rate(row.rateBasisPoints), base: money(row.netCentimes) })}
            </dt>
            <dd className="tabular-nums">{money(row.vatCentimes)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
          <dt>{credit ? label("totalCredit") : label("total")}</dt>
          <dd className="tabular-nums">{money(invoice.totalCentimes)}</dd>
        </div>
        {invoice.kind === "invoice" && invoice.status === "issued" && (
          <>
            {invoice.creditedCentimes > 0 && (
              <div className="flex justify-between gap-4">
                <dt>{label("credited")}</dt>
                <dd className="tabular-nums">{money(-invoice.creditedCentimes)}</dd>
              </div>
            )}
            {invoice.receivedCentimes !== 0 && (
              <div className="flex justify-between gap-4">
                <dt>{label("received")}</dt>
                <dd className="tabular-nums">{money(-invoice.receivedCentimes)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 font-semibold">
              <dt>{invoice.balanceCentimes < 0 ? label("overpaid") : label("balance")}</dt>
              <dd className="tabular-nums">{money(Math.abs(invoice.balanceCentimes))}</dd>
            </div>
          </>
        )}
      </dl>

      {invoice.notes && (
        <p dir="auto" className="text-sm break-words whitespace-pre-line">
          {invoice.notes}
        </p>
      )}

      <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted">
        {seller?.bankName && seller.rib && (
          <p>
            {label("bank", { bank: seller.bankName })}{" "}
            <bdi dir="ltr" className="font-mono">
              {seller.rib}
            </bdi>
          </p>
        )}
        {seller?.invoiceNote && <p className="whitespace-pre-line">{seller.invoiceNote}</p>}
      </footer>
    </article>
  );
}
