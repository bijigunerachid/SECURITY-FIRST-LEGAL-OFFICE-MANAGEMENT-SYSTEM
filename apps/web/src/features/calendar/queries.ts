import {
  agendaResponseSchema,
  hearingListResponseSchema,
  notificationListResponseSchema,
  taskListResponseSchema,
} from "@lexora/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";

export const calendarKey = ["calendar"] as const;
export const notificationsKey = ["notifications"] as const;

export function useHearings(matterId: string) {
  return useQuery({
    queryKey: [...calendarKey, "hearings", matterId],
    queryFn: ({ signal }) =>
      getJson(`/api/matters/${matterId}/hearings`, hearingListResponseSchema, { signal }),
  });
}

export function useTasks(matterId: string) {
  return useQuery({
    queryKey: [...calendarKey, "tasks", matterId],
    queryFn: ({ signal }) =>
      getJson(`/api/matters/${matterId}/tasks`, taskListResponseSchema, { signal }),
  });
}

export function useAgenda(from: string, to: string) {
  return useQuery({
    queryKey: [...calendarKey, "agenda", from, to],
    queryFn: ({ signal }) =>
      getJson(`/api/agenda?from=${from}&to=${to}`, agendaResponseSchema, { signal }),
    placeholderData: (previous) => previous,
  });
}

/** Checked again every minute, so new reminders appear without reloading. */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: ({ signal }) =>
      getJson("/api/notifications", notificationListResponseSchema, { signal }),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarKey }),
      queryClient.invalidateQueries({ queryKey: notificationsKey }),
    ]);
}

/**
 * Hearing times are shown exactly as the server computed them in office time
 * (`startsAtLocal`, "YYYY-MM-DDTHH:mm"). The browser only spells them out; it
 * never converts time zones itself, so a device with an outdated time-zone
 * database (for example one that still puts Morocco on UTC+1 after
 * 2026-09-20) cannot shift a hearing. Formatting the wall-clock value as if
 * it were UTC keeps its digits unchanged.
 */
export function useOfficeTime() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA";
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" });
  const wallClock = (local: string) => new Date(`${local}:00Z`);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  return {
    /** An office wall-clock time ("YYYY-MM-DDTHH:mm"), written out in full. */
    dateTime: (local: string) => dateTime.format(wallClock(local)),
    time: (local: string) => time.format(wallClock(local)),
    /** A calendar day (YYYY-MM-DD), written out in full. */
    day: (isoDate: string) => day.format(new Date(`${isoDate}T00:00:00Z`)),
  };
}

/** A calendar day `days` after `isoDate` (YYYY-MM-DD). */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
