import {
  createTaskRequestSchema,
  taskKinds,
  taskResponseSchema,
  updateTaskRequestSchema,
  type MatterDetail,
  type MatterTask,
  type TaskKind,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { ListPlus, Pencil, Trash2 } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { ConfirmDialog } from "@/features/matters/matter-ui";
import { invalidFields, officeToday, useFormat } from "@/features/matters/queries";
import { isApiError, send } from "@/lib/api";
import { useInvalidateCalendar, useTasks } from "./queries";

interface Values {
  kind: TaskKind;
  title: string;
  dueOn: string;
  notes: string;
  assigneeId: string;
}

function TaskDialog({
  matter,
  task,
  onClose,
}: {
  matter: MatterDetail;
  task: MatterTask | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateCalendar();
  const [values, setValues] = useState<Values>({
    kind: task?.kind ?? "deadline",
    title: task?.title ?? "",
    dueOn: task?.dueOn ?? "",
    notes: task?.notes ?? "",
    assigneeId: task?.assignee?.id ?? "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };
  // Only active lawyers and assistants on the team can be given a task.
  const people = matter.members.filter((m) => m.active && m.role !== "admin");

  const save = useMutation({
    mutationFn: (body: object) =>
      task
        ? send("PATCH", `/api/matters/${matter.id}/tasks/${task.id}`, body, taskResponseSchema)
        : send("POST", `/api/matters/${matter.id}/tasks`, body, taskResponseSchema),
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
    const common = {
      title: values.title,
      dueOn: values.dueOn === "" ? null : values.dueOn,
      notes: values.notes.trim() === "" ? null : values.notes,
      assigneeId: values.assigneeId === "" ? null : values.assigneeId,
    };
    const body = task ? common : { kind: values.kind, ...common };
    const schema = task ? updateTaskRequestSchema : createTaskRequestSchema;
    const next = invalidFields(schema.safeParse(body).error);
    if (values.kind === "deadline" && values.dueOn === "") next.add("dueOn");
    setInvalid(next);
    if (next.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optionalLabel = (label: string) => t("common.optional", { label });

  return (
    <Dialog open onClose={onClose} title={task ? t("tasks.editTitle") : t("tasks.addTitle")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {!task && (
          <Field label={t("tasks.kind")} hint={t("tasks.kindHint")}>
            {(props) => (
              <Select
                {...props}
                value={values.kind}
                onChange={(e) => {
                  set("kind", e.target.value as TaskKind);
                }}
              >
                {taskKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`taskKinds.${kind}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("tasks.titleLabel")} error={error("title")}>
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
          <Field
            label={values.kind === "deadline" ? t("tasks.dueOn") : optionalLabel(t("tasks.dueOn"))}
            error={error("dueOn")}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                min={task ? undefined : officeToday()}
                value={values.dueOn}
                onChange={(e) => {
                  set("dueOn", e.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t("tasks.assignee")} error={error("assigneeId")}>
            {(props) => (
              <Select
                {...props}
                value={values.assigneeId}
                onChange={(e) => {
                  set("assigneeId", e.target.value);
                }}
              >
                <option value="">{t("tasks.nobody")}</option>
                {people.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={optionalLabel(t("tasks.notes"))} error={error("notes")}>
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

export function TasksSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const invalidate = useInvalidateCalendar();
  const tasks = useTasks(matter.id);
  const [editing, setEditing] = useState<MatterTask | "new" | null>(null);
  const [removing, setRemoving] = useState<MatterTask | null>(null);
  const { writeCalendar, deleteTasks } = matter.permissions;
  const today = officeToday();

  const toggle = useMutation({
    mutationFn: (task: MatterTask) =>
      send("PATCH", `/api/matters/${matter.id}/tasks/${task.id}`, {
        completed: task.completedAt === null,
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (task: MatterTask) => send("DELETE", `/api/matters/${matter.id}/tasks/${task.id}`),
    onSuccess: async () => {
      setRemoving(null);
      await invalidate();
    },
  });

  return (
    <Section
      title={t("tasks.title")}
      actions={
        writeCalendar && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing("new");
            }}
          >
            <ListPlus className="size-4" aria-hidden="true" />
            {t("tasks.add")}
          </Button>
        )
      }
    >
      {tasks.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {tasks.isError && <Alert tone="danger">{errorMessage(tasks.error)}</Alert>}
      {toggle.isError && <Alert tone="danger">{errorMessage(toggle.error)}</Alert>}
      {tasks.data?.tasks.length === 0 && <p className="text-sm text-muted">{t("tasks.empty")}</p>}
      {tasks.data && tasks.data.tasks.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {tasks.data.tasks.map((task) => {
              const done = task.completedAt !== null;
              const overdue = !done && task.dueOn !== null && task.dueOn < today;
              return (
                <li
                  key={task.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
                >
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-brand"
                      checked={done}
                      disabled={!writeCalendar || toggle.isPending}
                      aria-label={t("tasks.markDone", { title: task.title })}
                      onChange={() => {
                        toggle.mutate(task);
                      }}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className={done ? "text-muted line-through" : undefined}>
                          {task.title}
                        </span>
                        <Badge tone={task.kind === "deadline" ? "accent" : "neutral"}>
                          {t(`taskKinds.${task.kind}`)}
                        </Badge>
                        {overdue && <Badge tone="danger">{t("tasks.overdue")}</Badge>}
                      </p>
                      <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                        <span>
                          {task.dueOn
                            ? t("tasks.due", { date: format.date(task.dueOn) })
                            : t("tasks.noDate")}
                        </span>
                        {task.assignee && (
                          <span>{t("tasks.assignedTo", { name: task.assignee.displayName })}</span>
                        )}
                        {task.completedAt && task.completedBy && (
                          <span>
                            {t("tasks.done", {
                              date: format.date(task.completedAt.slice(0, 10)),
                              name: task.completedBy.displayName,
                            })}
                          </span>
                        )}
                      </p>
                      {task.notes && (
                        <p className="text-sm break-words whitespace-pre-line">{task.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {writeCalendar && (
                      <Button
                        variant="outline"
                        aria-label={t("tasks.edit", { title: task.title })}
                        onClick={() => {
                          setEditing(task);
                        }}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                        {t("common.edit")}
                      </Button>
                    )}
                    {deleteTasks && (
                      <Button
                        variant="outline"
                        className="text-danger"
                        aria-label={t("tasks.remove", { title: task.title })}
                        onClick={() => {
                          setRemoving(task);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t("common.remove")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {editing && (
        <TaskDialog
          matter={matter}
          task={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t("tasks.removeTitle")}
        message={t("tasks.confirmRemove", { title: removing?.title ?? "" })}
        error={remove.isError ? errorMessage(remove.error) : null}
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
      />
    </Section>
  );
}
