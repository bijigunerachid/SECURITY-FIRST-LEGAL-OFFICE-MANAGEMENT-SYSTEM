import { useMutation } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/feedback";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { useSession } from "@/features/auth/session";
import { useFormat } from "@/features/matters/queries";
import { send } from "@/lib/api";
import { ltr } from "@/lib/utils";
import { useInvalidateCalendar, useNotifications } from "./queries";

/** The header bell: a link to the reminders page with the number of unread reminders. */
export function NotificationBell() {
  const { t } = useTranslation();
  const signedIn = useSession().data?.state === "active";
  const notifications = useNotifications(signedIn);
  const unread = notifications.data?.unread ?? 0;
  if (!signedIn) return null;
  return (
    <Link
      to="/notifications"
      aria-label={
        unread > 0 ? t("notifications.bellUnread", { count: unread }) : t("notifications.bell")
      }
      className="relative inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted"
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute end-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-surface"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const invalidate = useInvalidateCalendar();
  const notifications = useNotifications();

  const read = useMutation({
    mutationFn: (id: string) => send("POST", `/api/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: () => send("POST", "/api/notifications/read-all"),
    onSuccess: invalidate,
  });

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={t("notifications.title")} description={t("notifications.description")} />
        {(notifications.data?.unread ?? 0) > 0 && (
          <Button
            variant="outline"
            className="shrink-0"
            disabled={readAll.isPending}
            onClick={() => {
              readAll.mutate();
            }}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            {t("notifications.markAllRead")}
          </Button>
        )}
      </div>
      {notifications.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {notifications.isError && <Alert tone="danger">{errorMessage(notifications.error)}</Alert>}
      {(read.isError || readAll.isError) && (
        <Alert tone="danger">{errorMessage(read.error ?? readAll.error)}</Alert>
      )}
      {notifications.data?.notifications.length === 0 && (
        <p className="text-sm text-muted">{t("notifications.empty")}</p>
      )}
      {notifications.data && notifications.data.notifications.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {notifications.data.notifications.map((n) => (
              <li
                key={n.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {t(`notifications.messages.${n.kind}.${n.stage}`, { defaultValue: n.subject })}
                    {!n.read && <Badge tone="danger">{t("notifications.unread")}</Badge>}
                  </p>
                  <p className="text-sm break-words">{n.subject}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>
                      {t("notifications.due", { date: format.date(n.dueAt.slice(0, 10)) })}
                    </span>
                    <Link
                      to={`/matters/${n.matter.id}`}
                      className="text-ink underline decoration-accent decoration-2 underline-offset-4"
                    >
                      {t("notifications.matter", { reference: ltr(n.matter.reference) })}
                    </Link>
                  </p>
                </div>
                {!n.read && (
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={read.isPending}
                    aria-label={t("users.labelValue", {
                      label: t("notifications.markRead"),
                      value: n.subject,
                    })}
                    onClick={() => {
                      read.mutate(n.id);
                    }}
                  >
                    {t("notifications.markRead")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
