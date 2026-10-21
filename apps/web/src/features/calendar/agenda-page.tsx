import type { AgendaResponse } from "@lexora/shared";
import { ChevronLeft, ChevronRight, Gavel, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader, Section } from "@/components/ui/feedback";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { ltr } from "@/lib/utils";
import { officeToday, useFormat } from "@/features/matters/queries";
import { addDays, useAgenda, useOfficeTime } from "./queries";

const WINDOW_DAYS = 30;

type Entry =
  | { kind: "hearing"; day: string; item: AgendaResponse["hearings"][number] }
  | { kind: "task"; day: string; item: AgendaResponse["tasks"][number] };

function MatterLink({ matter }: { matter: { id: string; reference: string; title: string } }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/matters/${matter.id}`}
      className="text-sm text-ink underline decoration-accent decoration-2 underline-offset-4"
    >
      {t("agenda.matter", { reference: ltr(matter.reference), title: matter.title })}
    </Link>
  );
}

function TaskLine({ task }: { task: AgendaResponse["tasks"][number] }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3">
      <ListChecks className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {task.title}
          <Badge tone={task.kind === "deadline" ? "accent" : "neutral"}>
            {t(`taskKinds.${task.kind}`)}
          </Badge>
        </p>
        {task.assignee && (
          <p className="text-sm text-muted">
            {t("tasks.assignedTo", { name: task.assignee.displayName })}
          </p>
        )}
        <MatterLink matter={task.matter} />
      </div>
    </div>
  );
}

/** Hearings, deadlines and tasks from the user's matters, 30 days at a time, overdue items first. */
export function AgendaPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const office = useOfficeTime();
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const today = officeToday();
  const fromParam = params.get("from");
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : today;
  const to = addDays(from, WINDOW_DAYS - 1);
  const agenda = useAgenda(from, to);

  const entries: Entry[] = agenda.data
    ? [
        ...agenda.data.hearings.map((item) => ({
          kind: "hearing" as const,
          day: item.startsAtLocal.slice(0, 10),
          item,
        })),
        ...agenda.data.tasks.map((item) => ({
          kind: "task" as const,
          day: item.dueOn ?? from,
          item,
        })),
      ].sort((a, b) =>
        a.day === b.day
          ? (a.kind === "hearing" ? a.item.startsAtLocal : `${a.day}T99`).localeCompare(
              b.kind === "hearing" ? b.item.startsAtLocal : `${b.day}T99`,
            )
          : a.day.localeCompare(b.day),
      )
    : [];
  const days = [...new Set(entries.map((e) => e.day))];
  const go = (next: string) => {
    setParams(next === today ? {} : { from: next });
  };

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <PageHeader title={t("agenda.title")} description={t("agenda.description")} />
      <nav
        aria-label={t("agenda.range", { from: format.date(from), to: format.date(to) })}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <Button
          variant="outline"
          onClick={() => {
            go(addDays(from, -WINDOW_DAYS));
          }}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("agenda.previous")}
        </Button>
        <p className="text-sm font-medium">
          {t("agenda.range", { from: format.date(from), to: format.date(to) })}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            go(addDays(from, WINDOW_DAYS));
          }}
        >
          {t("agenda.next")}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </nav>

      {agenda.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {agenda.isError && <Alert tone="danger">{errorMessage(agenda.error)}</Alert>}

      {agenda.data && agenda.data.overdue.length > 0 && from === today && (
        <Section title={t("agenda.overdue")}>
          <Card className="border-danger/40 p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {agenda.data.overdue.map((task) => (
                <li key={task.id} className="space-y-1 p-4 sm:px-6">
                  <p className="text-sm font-medium text-danger">
                    {task.dueOn ? t("tasks.due", { date: format.date(task.dueOn) }) : null}
                  </p>
                  <TaskLine task={task} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {agenda.data && entries.length === 0 && (
        <p className="text-sm text-muted">{t("agenda.empty")}</p>
      )}
      {days.map((dayKey) => (
        <Section key={dayKey} title={office.day(dayKey)}>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {entries
                .filter((e) => e.day === dayKey)
                .map((entry) =>
                  entry.kind === "hearing" ? (
                    <li key={entry.item.id} className="p-4 sm:px-6">
                      <div className="flex gap-3">
                        <Gavel className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium">
                            <time dateTime={entry.item.startsAt}>
                              {office.time(entry.item.startsAt)}
                            </time>
                            {" · "}
                            {t("agenda.hearing")} — {entry.item.title}
                          </p>
                          {(entry.item.court ?? entry.item.room) && (
                            <p className="text-sm text-muted">
                              {[entry.item.court, entry.item.room].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          <MatterLink matter={entry.item.matter} />
                        </div>
                      </div>
                    </li>
                  ) : (
                    <li key={entry.item.id} className="p-4 sm:px-6">
                      <TaskLine task={entry.item} />
                    </li>
                  ),
                )}
            </ul>
          </Card>
        </Section>
      ))}
    </section>
  );
}
