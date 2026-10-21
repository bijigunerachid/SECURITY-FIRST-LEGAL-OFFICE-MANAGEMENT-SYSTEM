import {
  agendaQuerySchema,
  createHearingRequestSchema,
  createTaskRequestSchema,
  updateHearingRequestSchema,
  updateTaskRequestSchema,
} from "@lexora/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { CalendarService } from "../../modules/calendar/calendar-service.js";
import type { NotificationService } from "../../modules/calendar/notifications.js";
import type { Actor } from "../../modules/policy/matter-policy.js";
import { notFound } from "../errors.js";
import { sessionOf } from "../middleware/auth.js";
import { requestContext } from "./auth.js";

const idSchema = z.uuid();

function validateIds(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(idSchema.safeParse(value).success ? undefined : notFound());
    });
  }
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function actorOf(req: Request): Actor {
  const { user } = sessionOf(req);
  return { id: user.id, role: user.role };
}

/** /api/matters/:matterId/hearings */
export function hearingsRouter(calendar: CalendarService): Router {
  const router = Router({ mergeParams: true });
  validateIds(router, "matterId", "hearingId");

  router.get("/", async (req, res) => {
    const hearings = await calendar.listHearings(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ hearings });
  });

  router.post("/", async (req, res) => {
    const input = createHearingRequestSchema.parse(req.body);
    const hearing = await calendar.createHearing(
      actorOf(req),
      param(req, "matterId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ hearing });
  });

  router.patch("/:hearingId", async (req, res) => {
    const changes = updateHearingRequestSchema.parse(req.body);
    const hearing = await calendar.updateHearing(
      actorOf(req),
      param(req, "matterId"),
      param(req, "hearingId"),
      changes,
      requestContext(req),
    );
    res.json({ hearing });
  });

  return router;
}

/** /api/matters/:matterId/tasks (deadlines and tasks) */
export function tasksRouter(calendar: CalendarService): Router {
  const router = Router({ mergeParams: true });
  validateIds(router, "matterId", "taskId");

  router.get("/", async (req, res) => {
    const tasks = await calendar.listTasks(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ tasks });
  });

  router.post("/", async (req, res) => {
    const input = createTaskRequestSchema.parse(req.body);
    const task = await calendar.createTask(
      actorOf(req),
      param(req, "matterId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ task });
  });

  router.patch("/:taskId", async (req, res) => {
    const changes = updateTaskRequestSchema.parse(req.body);
    const task = await calendar.updateTask(
      actorOf(req),
      param(req, "matterId"),
      param(req, "taskId"),
      changes,
      requestContext(req),
    );
    res.json({ task });
  });

  router.delete("/:taskId", async (req, res) => {
    await calendar.deleteTask(
      actorOf(req),
      param(req, "matterId"),
      param(req, "taskId"),
      requestContext(req),
    );
    res.status(204).end();
  });

  return router;
}

/** /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD: the signed-in person's agenda across visible matters. */
export function agendaRouter(calendar: CalendarService): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const { from, to } = agendaQuerySchema.parse(req.query);
    res.json(await calendar.agenda(actorOf(req), from, to));
  });
  return router;
}

/** /api/notifications: the signed-in person's own reminders. */
export function notificationsRouter(notifications: NotificationService): Router {
  const router = Router();
  validateIds(router, "notificationId");

  router.get("/", async (req, res) => {
    res.json(await notifications.list(actorOf(req)));
  });

  router.post("/read-all", async (req, res) => {
    await notifications.markAllRead(actorOf(req));
    res.status(204).end();
  });

  router.post("/:notificationId/read", async (req, res) => {
    await notifications.markRead(actorOf(req), param(req, "notificationId"));
    res.status(204).end();
  });

  return router;
}
