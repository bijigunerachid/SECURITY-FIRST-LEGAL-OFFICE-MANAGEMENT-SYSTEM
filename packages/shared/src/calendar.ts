import { z } from "zod";
import { calendarDateSchema, multiLine, optional, personRefSchema, singleLine } from "./matters.js";

/**
 * Hearings, deadlines and tasks, the agenda, and in-app reminders.
 *
 * Hearing times are entered as office wall-clock time ("YYYY-MM-DDTHH:mm" in
 * Africa/Casablanca) and returned both as an instant and as office time.
 */

export const OFFICE_TIME_ZONE = "Africa/Casablanca";

export const hearingStatuses = ["scheduled", "held", "postponed", "cancelled"] as const;
export const hearingStatusSchema = z.enum(hearingStatuses);
export type HearingStatus = z.infer<typeof hearingStatusSchema>;

export const taskKinds = ["deadline", "task"] as const;
export const taskKindSchema = z.enum(taskKinds);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const notificationKinds = [
  "hearing_soon",
  "deadline_soon",
  "deadline_overdue",
  "task_due",
  "task_assigned",
] as const;
export const notificationKindSchema = z.enum(notificationKinds);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** Office wall-clock time, minutes precision: "2026-11-03T09:30". */
export const officeDateTimeSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/)
  // A real calendar date survives a round trip unchanged; 2026-02-30 does not.
  .refine((value) => {
    const parsed = new Date(`${value}:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
  }, "not a real date");

const uuid = z.uuid();
const matterRefSchema = z.strictObject({ id: uuid, reference: z.string(), title: z.string() });

// --- Hearings -------------------------------------------------------------------

export const createHearingRequestSchema = z.strictObject({
  startsAt: officeDateTimeSchema,
  title: singleLine(200).pipe(z.string().min(1)),
  court: optional(singleLine(200)),
  room: optional(singleLine(100)),
  notes: optional(multiLine(2000)),
});

export const updateHearingRequestSchema = z
  .strictObject({
    startsAt: officeDateTimeSchema.optional(),
    title: singleLine(200).pipe(z.string().min(1)).optional(),
    court: optional(singleLine(200)),
    room: optional(singleLine(100)),
    notes: optional(multiLine(2000)),
    status: hearingStatusSchema.optional(),
    outcome: optional(multiLine(2000)),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

export const hearingSchema = z.strictObject({
  id: uuid,
  matterId: uuid,
  startsAt: z.iso.datetime(),
  /** The same moment in office time, "YYYY-MM-DDTHH:mm". */
  startsAtLocal: z.string(),
  title: z.string(),
  court: z.string().nullable(),
  room: z.string().nullable(),
  notes: z.string().nullable(),
  status: hearingStatusSchema,
  outcome: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Hearing = z.infer<typeof hearingSchema>;

export const hearingListResponseSchema = z.strictObject({ hearings: z.array(hearingSchema) });
export const hearingResponseSchema = z.strictObject({ hearing: hearingSchema });

// --- Deadlines and tasks ----------------------------------------------------------

export const createTaskRequestSchema = z
  .strictObject({
    kind: taskKindSchema,
    title: singleLine(200).pipe(z.string().min(1)),
    dueOn: calendarDateSchema.nullable().optional(),
    notes: optional(multiLine(2000)),
    assigneeId: uuid.nullable().optional(),
  })
  .refine((body) => body.kind !== "deadline" || (body.dueOn ?? null) !== null, {
    message: "a deadline needs a date",
    path: ["dueOn"],
  });

export const updateTaskRequestSchema = z
  .strictObject({
    title: singleLine(200).pipe(z.string().min(1)).optional(),
    dueOn: calendarDateSchema.nullable().optional(),
    notes: optional(multiLine(2000)),
    assigneeId: uuid.nullable().optional(),
    completed: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

export const taskSchema = z.strictObject({
  id: uuid,
  matterId: uuid,
  kind: taskKindSchema,
  title: z.string(),
  dueOn: calendarDateSchema.nullable(),
  notes: z.string().nullable(),
  assignee: personRefSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  completedBy: personRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type MatterTask = z.infer<typeof taskSchema>;

export const taskListResponseSchema = z.strictObject({ tasks: z.array(taskSchema) });
export const taskResponseSchema = z.strictObject({ task: taskSchema });

// --- Agenda -----------------------------------------------------------------------

export const AGENDA_MAX_DAYS = 92;

export const agendaQuerySchema = z
  .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
  .refine((q) => q.from <= q.to, { message: "from after to", path: ["to"] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= AGENDA_MAX_DAYS, {
    message: "range too long",
    path: ["to"],
  });

export const agendaResponseSchema = z.strictObject({
  hearings: z.array(z.strictObject({ ...hearingSchema.shape, matter: matterRefSchema })),
  tasks: z.array(z.strictObject({ ...taskSchema.shape, matter: matterRefSchema })),
  /** Open deadlines and tasks due before `from`. */
  overdue: z.array(z.strictObject({ ...taskSchema.shape, matter: matterRefSchema })),
});
export type AgendaResponse = z.infer<typeof agendaResponseSchema>;

// --- Notifications -------------------------------------------------------------------

export const notificationSchema = z.strictObject({
  id: uuid,
  kind: notificationKindSchema,
  stage: z.string(),
  dueAt: z.iso.datetime(),
  /** The office calendar day of dueAt, computed by the server (YYYY-MM-DD). */
  dueDate: calendarDateSchema,
  createdAt: z.iso.datetime(),
  read: z.boolean(),
  matter: matterRefSchema,
  /** The hearing's or task's title. */
  subject: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.strictObject({
  notifications: z.array(notificationSchema),
  unread: z.number().int().min(0),
});
