import type { MatterDetail } from "@lexora/shared";
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Section } from "@/components/ui/feedback";
import {
  useActionLabel,
  useMatterHistory,
  useOfficeDateTime,
} from "@/features/admin/audit-queries";
import { useErrorMessage } from "@/features/auth/use-error-message";

/**
 * Who read or changed what on this matter, for its lead lawyer: team
 * members, administrators under break-glass access, and refused attempts.
 * Loaded only when asked for (reading it is itself recorded).
 */
export function HistorySection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const label = useActionLabel();
  const dateTime = useOfficeDateTime();
  const [open, setOpen] = useState(false);
  const history = useMatterHistory(matter.id, open);
  if (!matter.permissions.readHistory) return null;

  return (
    <Section title={t("history.title")}>
      <p className="text-sm text-muted">{t("history.description")}</p>
      {!open && (
        <Button
          variant="outline"
          onClick={() => {
            setOpen(true);
          }}
        >
          <History className="size-4" aria-hidden="true" />
          {t("history.show")}
        </Button>
      )}
      {open && history.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {history.isError && <Alert tone="danger">{errorMessage(history.error)}</Alert>}
      {history.data && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {history.data.pages.flatMap((page) =>
              page.events.map((event) => (
                <li key={event.id} className="space-y-1 p-4 sm:px-6">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label(event.action)}</span>
                    {event.outcome !== "success" && (
                      <Badge tone="danger">{t(`auditOutcomes.${event.outcome}`)}</Badge>
                    )}
                    {event.breakGlass && <Badge tone="danger">{t("history.breakGlass")}</Badge>}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>{dateTime(event.occurredAtOffice)}</span>
                    <span>{event.actor ? event.actor.displayName : t("audit.noActor")}</span>
                    {event.fields && event.fields.length > 0 && (
                      <span>{t("history.fields", { fields: event.fields.join(", ") })}</span>
                    )}
                  </p>
                </li>
              )),
            )}
          </ul>
        </Card>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            void history.fetchNextPage();
          }}
        >
          {t("audit.more")}
        </Button>
      )}
    </Section>
  );
}
