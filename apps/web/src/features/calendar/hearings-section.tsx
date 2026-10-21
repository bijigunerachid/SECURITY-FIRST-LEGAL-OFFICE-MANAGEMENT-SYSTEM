import {
  createHearingRequestSchema,
  hearingResponseSchema,
  hearingStatuses,
  updateHearingRequestSchema,
  type Hearing,
  type HearingStatus,
  type MatterDetail,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { CalendarPlus, Pencil } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { invalidFields, officeToday } from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";
import { useHearings, useInvalidateCalendar, useOfficeTime } from "./queries";

const statusTone: Record<HearingStatus, "success" | "neutral" | "danger"> = {
  scheduled: "success",
  held: "neutral",
  postponed: "neutral",
  cancelled: "danger",
};

interface Values {
  startsAt: string;
  title: string;
  court: string;
  room: string;
  notes: string;
  status: HearingStatus;
  outcome: string;
}

function HearingDialog({
  matter,
  hearing,
  onClose,
}: {
  matter: MatterDetail;
  hearing: Hearing | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateCalendar();
  const [values, setValues] = useState<Values>({
    startsAt: hearing?.startsAtLocal ?? `${officeToday()}T09:00`,
    title: hearing?.title ?? "",
    court: hearing?.court ?? matter.court ?? "",
    room: hearing?.room ?? "",
    notes: hearing?.notes ?? "",
    status: hearing?.status ?? "scheduled",
    outcome: hearing?.outcome ?? "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (body: object) =>
      hearing
        ? send(
            "PATCH",
            `/api/matters/${matter.id}/hearings/${hearing.id}`,
            body,
            hearingResponseSchema,
          )
        : send("POST", `/api/matters/${matter.id}/hearings`, body, hearingResponseSchema),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const optional = (v: string) => (v.trim() === "" ? null : v);
    const base = {
      startsAt: values.startsAt,
      title: values.title,
      court: optional(values.court),
      room: optional(values.room),
      notes: optional(values.notes),
    };
    const body = hearing
      ? { ...base, status: values.status, outcome: optional(values.outcome) }
      : base;
    const schema = hearing ? updateHearingRequestSchema : createHearingRequestSchema;
    const next = invalidFields(schema.safeParse(body).error);
    if (hearing && values.status === "scheduled" && values.outcome.trim() !== "")
      next.add("outcome");
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optionalLabel = (label: string) => t("common.optional", { label });

  return (
    <Dialog
      open
      onClose={onClose}
      title={hearing ? t("hearings.editTitle") : t("hearings.addTitle")}
    >
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <Field label={t("hearings.startsAt")} error={error("startsAt")}>
          {(props) => (
            <Input
              {...props}
              type="datetime-local"
              value={values.startsAt}
              onChange={(e) => {
                set("startsAt", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("hearings.titleLabel")} error={error("title")}>
          {(props) => (
            <Input
              {...props}
              maxLength={200}
              value={values.title}
              onChange={(e) => {
                set("title", e.target.value);
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={optionalLabel(t("hearings.court"))} error={error("court")}>
            {(props) => (
              <Input
                {...props}
                maxLength={200}
                value={values.court}
                onChange={(e) => {
                  set("court", e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={optionalLabel(t("hearings.room"))} error={error("room")}>
            {(props) => (
              <Input
                {...props}
                maxLength={100}
                value={values.room}
                onChange={(e) => {
                  set("room", e.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Field label={optionalLabel(t("hearings.notes"))} error={error("notes")}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={2000}
              value={values.notes}
              onChange={(e) => {
                set("notes", e.target.value);
              }}
            />
          )}
        </Field>
        {hearing && (
          <>
            <Field label={t("hearings.status")}>
              {(props) => (
                <Select
                  {...props}
                  value={values.status}
                  onChange={(e) => {
                    set("status", e.target.value as HearingStatus);
                  }}
                >
                  {hearingStatuses.map((status) => (
                    <option key={status} value={status}>
                      {t(`hearingStatuses.${status}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={optionalLabel(t("hearings.outcome"))}
              hint={t("hearings.outcomeHint")}
              error={invalid.has("outcome") ? t("hearings.outcomeHint") : undefined}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  maxLength={2000}
                  value={values.outcome}
                  onChange={(e) => {
                    set("outcome", e.target.value);
                  }}
                />
              )}
            </Field>
          </>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function HearingsSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const office = useOfficeTime();
  const hearings = useHearings(matter.id);
  const [editing, setEditing] = useState<Hearing | "new" | null>(null);
  const canWrite = matter.permissions.writeCalendar;

  return (
    <Section
      title={t("hearings.title")}
      actions={
        canWrite && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing("new");
            }}
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            {t("hearings.add")}
          </Button>
        )
      }
    >
      {hearings.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {hearings.isError && <Alert tone="danger">{errorMessage(hearings.error)}</Alert>}
      {hearings.data?.hearings.length === 0 && (
        <p className="text-sm text-muted">{t("hearings.empty")}</p>
      )}
      {hearings.data && hearings.data.hearings.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {hearings.data.hearings.map((hearing) => (
              <li
                key={hearing.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {hearing.title}
                    <Badge tone={statusTone[hearing.status]}>
                      {t(`hearingStatuses.${hearing.status}`)}
                    </Badge>
                  </p>
                  <p className="text-sm">
                    <time dateTime={hearing.startsAt}>{office.dateTime(hearing.startsAt)}</time>
                  </p>
                  {(hearing.court ?? hearing.room) && (
                    <p className="text-sm text-muted">
                      {[hearing.court, hearing.room].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {hearing.outcome && (
                    <p className="text-sm break-words whitespace-pre-line">
                      {t("users.labelValue", {
                        label: t("hearings.outcome"),
                        value: hearing.outcome,
                      })}
                    </p>
                  )}
                </div>
                {canWrite && (
                  <Button
                    variant="outline"
                    className="shrink-0"
                    aria-label={t("hearings.edit", { title: hearing.title })}
                    onClick={() => {
                      setEditing(hearing);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t("common.edit")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <HearingDialog
          matter={matter}
          hearing={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Section>
  );
}
