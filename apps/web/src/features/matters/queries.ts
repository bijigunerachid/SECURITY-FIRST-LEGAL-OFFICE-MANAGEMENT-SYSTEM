import {
  breakGlassListResponseSchema,
  clientListResponseSchema,
  clientResponseSchema,
  conflictResponseSchema,
  matterListResponseSchema,
  matterResponseSchema,
  teamCandidatesResponseSchema,
  type MatterStatus,
} from "@lexora/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { getJson } from "@/lib/api";

/**
 * Data hooks for clients, matters, conflict searches and break-glass access.
 * Every response is validated against the shared schema (see lib/api.ts).
 */

export const mattersKey = ["matters"] as const;
export const clientsKey = ["clients"] as const;
export const breakGlassKey = ["break-glass"] as const;

function withParams(
  path: `/api/${string}`,
  params: Record<string, string | number | undefined>,
): `/api/${string}` {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function useMatterList(params: { q: string; status: MatterStatus | ""; page: number }) {
  return useQuery({
    queryKey: [...mattersKey, "list", params],
    queryFn: ({ signal }) =>
      getJson(
        withParams("/api/matters", {
          q: params.q.trim(),
          status: params.status || undefined,
          page: params.page,
        }),
        matterListResponseSchema,
        { signal },
      ),
    placeholderData: (previous) => previous,
  });
}

export function useMatter(matterId: string) {
  return useQuery({
    queryKey: [...mattersKey, "detail", matterId],
    queryFn: ({ signal }) =>
      getJson(`/api/matters/${encodeURIComponent(matterId)}`, matterResponseSchema, { signal }),
  });
}

export function useTeamCandidates(matterId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...mattersKey, "candidates", matterId],
    queryFn: ({ signal }) =>
      getJson(
        `/api/matters/${encodeURIComponent(matterId)}/candidates`,
        teamCandidatesResponseSchema,
        { signal },
      ),
    enabled,
  });
}

export function useClientList(params: { q: string; page: number }, enabled = true) {
  return useQuery({
    queryKey: [...clientsKey, "list", params],
    queryFn: ({ signal }) =>
      getJson(
        withParams("/api/clients", { q: params.q.trim(), page: params.page }),
        clientListResponseSchema,
        { signal },
      ),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useClient(clientId: string | null) {
  return useQuery({
    queryKey: [...clientsKey, "detail", clientId],
    queryFn: ({ signal }) =>
      getJson(`/api/clients/${encodeURIComponent(clientId ?? "")}`, clientResponseSchema, {
        signal,
      }),
    enabled: clientId !== null,
  });
}

/**
 * Runs a conflict search for the submitted text only (not on every key
 * press: each search is rate limited and audited). Results are not kept
 * after the page is left.
 */
export function useConflictSearch(q: string | null) {
  return useQuery({
    queryKey: ["conflicts", q],
    queryFn: ({ signal }) =>
      getJson(withParams("/api/conflicts", { q: q ?? "" }), conflictResponseSchema, { signal }),
    enabled: q !== null,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
}
export type ConflictResult = z.infer<typeof conflictResponseSchema>;

export function useBreakGlassGrants() {
  return useQuery({
    queryKey: breakGlassKey,
    queryFn: ({ signal }) => getJson("/api/break-glass", breakGlassListResponseSchema, { signal }),
  });
}

/** After any change: reload matters, clients and grants. */
export function useInvalidateMatters() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: mattersKey }),
      queryClient.invalidateQueries({ queryKey: clientsKey }),
      queryClient.invalidateQueries({ queryKey: breakGlassKey }),
    ]);
}

/** Dates and times in the reader's language. Calendar dates are shown as stored (no time zone shift). */
export function useFormat() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA";
  return {
    date: (isoDate: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${isoDate}T00:00:00Z`),
      ),
    time: (isoDateTime: string) =>
      new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(isoDateTime)),
  };
}

/** Paths of the fields a Zod schema refused, for highlighting them. */
export function invalidFields(error: z.ZodError | undefined | null): Set<string> {
  return new Set(error?.issues.map((issue) => issue.path.map(String).join(".")) ?? []);
}

/** Today's date in the office (Morocco), as YYYY-MM-DD, for date inputs. */
export function officeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
