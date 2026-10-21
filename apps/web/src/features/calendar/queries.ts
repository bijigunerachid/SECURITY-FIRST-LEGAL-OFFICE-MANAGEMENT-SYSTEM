import {
  OFFICE_TIME_ZONE,
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

/** Hearing times are always shown in office time, whatever the device's time zone. */
export function useOfficeTime() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA";
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: OFFICE_TIME_ZONE,
  });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: OFFICE_TIME_ZONE });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  return {
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
    time: (iso: string) => time.format(new Date(iso)),
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
