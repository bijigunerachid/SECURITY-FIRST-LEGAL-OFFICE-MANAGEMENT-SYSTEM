import {
  alertCountResponseSchema,
  alertListResponseSchema,
  auditListResponseSchema,
  matterHistoryResponseSchema,
  type AlertView,
  type AuditQuery,
} from "@lexora/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";

/** Data hooks for the audit-log viewer, the matter history and security alerts. */

export const auditKey = ["audit"] as const;
export const alertsKey = ["alerts"] as const;

function withParams(
  path: `/api/${string}`,
  params: Record<string, string | undefined>,
): `/api/${string}` {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Pages are loaded one after another ("load more"), newest first. */
export function useAuditEvents(filters: Omit<AuditQuery, "before">) {
  return useInfiniteQuery({
    queryKey: [...auditKey, "events", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getJson(
        withParams("/api/admin/audit", { ...filters, before: pageParam }),
        auditListResponseSchema,
        {
          signal,
        },
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

export function useMatterHistory(matterId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...auditKey, "history", matterId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getJson(
        withParams(`/api/matters/${encodeURIComponent(matterId)}/history`, { before: pageParam }),
        matterHistoryResponseSchema,
        { signal },
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled,
  });
}

export function useAlerts(view: AlertView, page: number) {
  return useQuery({
    queryKey: [...alertsKey, "list", view, page],
    queryFn: ({ signal }) =>
      getJson(`/api/admin/alerts?view=${view}&page=${String(page)}`, alertListResponseSchema, {
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}

/** Checked every minute for the menu badge. */
export function useAlertCount(enabled: boolean) {
  return useQuery({
    queryKey: [...alertsKey, "count"],
    queryFn: ({ signal }) =>
      getJson("/api/admin/alerts/count", alertCountResponseSchema, { signal }),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useInvalidateAlerts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: alertsKey });
}

/**
 * A readable name for an audit action ("invoice.issue" → "Facture émise").
 * Unknown actions show their code, so nothing recorded is ever hidden.
 */
export function useActionLabel() {
  const { t } = useTranslation();
  return (action: string) =>
    t(`auditActions.${action.replace(/\./g, "_")}`, { defaultValue: action });
}

/**
 * An office time computed by the server ("YYYY-MM-DDTHH:mm:ss"), spelled out
 * in the reader's language. Formatting the wall-clock value as UTC keeps its
 * digits: the browser never converts time zones (its data may be outdated).
 */
export function useOfficeDateTime() {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  });
  return (office: string) => format.format(new Date(`${office}Z`));
}
