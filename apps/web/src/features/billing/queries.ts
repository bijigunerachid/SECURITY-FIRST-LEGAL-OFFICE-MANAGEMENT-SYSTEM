import {
  billingSettingsResponseSchema,
  billingSummaryResponseSchema,
  feeAgreementListResponseSchema,
  invoiceListResponseSchema,
  invoiceResponseSchema,
  matterInvoiceListResponseSchema,
  type InvoiceView,
} from "@lexora/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";

/**
 * Data hooks and number helpers for fees, invoices and payments. Amounts
 * travel as whole centimes and quantities as hundredths; the browser only
 * parses what is typed and formats what the server computed.
 */

export const billingKey = ["billing"] as const;

const matterPath = (matterId: string) => `/api/matters/${encodeURIComponent(matterId)}` as const;

export function useBillingSettings() {
  return useQuery({
    queryKey: [...billingKey, "settings"],
    queryFn: ({ signal }) =>
      getJson("/api/billing/settings", billingSettingsResponseSchema, { signal }),
  });
}

export function useBillingSummary(year: number) {
  return useQuery({
    queryKey: [...billingKey, "summary", year],
    queryFn: ({ signal }) =>
      getJson(`/api/billing/summary?year=${String(year)}`, billingSummaryResponseSchema, {
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useFeeAgreements(matterId: string) {
  return useQuery({
    queryKey: [...billingKey, "fee-agreements", matterId],
    queryFn: ({ signal }) =>
      getJson(`${matterPath(matterId)}/fee-agreements`, feeAgreementListResponseSchema, { signal }),
  });
}

export function useMatterInvoices(matterId: string) {
  return useQuery({
    queryKey: [...billingKey, "matter-invoices", matterId],
    queryFn: ({ signal }) =>
      getJson(`${matterPath(matterId)}/invoices`, matterInvoiceListResponseSchema, { signal }),
  });
}

export function useInvoice(matterId: string, invoiceId: string) {
  return useQuery({
    queryKey: [...billingKey, "invoice", invoiceId],
    queryFn: ({ signal }) =>
      getJson(
        `${matterPath(matterId)}/invoices/${encodeURIComponent(invoiceId)}`,
        invoiceResponseSchema,
        { signal },
      ),
  });
}

export function useInvoiceList(view: InvoiceView, page: number) {
  return useQuery({
    queryKey: [...billingKey, "list", view, page],
    queryFn: ({ signal }) =>
      getJson(`/api/invoices?view=${view}&page=${String(page)}`, invoiceListResponseSchema, {
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: billingKey });
}

export const invoicePath = (matterId: string, invoiceId: string) =>
  `/matters/${matterId}/invoices/${invoiceId}`;

/**
 * Typed amounts: digits, optional spaces (including the no-break spaces
 * Intl uses) as thousands separators, and a
 * comma or a point before at most two decimals ("1 500,50", "1500.5",
 * "1.500,50"). An ambiguous "1.500" is refused rather than guessed.
 * Returns whole hundredths (centimes for money), or null if not a number.
 */
export function parseHundredths(text: string): number | null {
  let compact = text.replace(/\s/g, "");
  // "1.500,50", as fr-MA writes amounts: with a comma decimal, points group thousands.
  if (compact.includes(",") && /^\d{1,3}(?:\.\d{3})+,/.test(compact)) {
    compact = compact.replace(/\./g, "");
  }
  compact = compact.replace(",", ".");
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const units = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const value = units * 100 + fraction;
  return Number.isSafeInteger(value) ? value : null;
}

/** Hundredths as an input value: 150 → "1,50", 100 → "1". */
export function hundredthsToInput(value: number): string {
  const units = Math.trunc(value / 100);
  const fraction = value % 100;
  return fraction === 0 ? String(units) : `${String(units)},${String(fraction).padStart(2, "0")}`;
}

/** Money and numbers in the reader's language. */
export function useMoney() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
  });
  const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return {
    /** Centimes as an amount in dirhams. */
    money: (centimes: number) => money.format(centimes / 100),
    quantity: (hundredths: number) => quantity.format(hundredths / 100),
    /** Basis points as a percentage: 2000 → "20 %". */
    rate: (basisPoints: number) => `${percent.format(basisPoints / 100)} %`,
  };
}
