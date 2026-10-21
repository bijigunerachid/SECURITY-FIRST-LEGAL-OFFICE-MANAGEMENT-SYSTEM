import { describe, expect, it } from "vitest";
import {
  agendaQuerySchema,
  createTaskRequestSchema,
  officeDateTimeSchema,
  updateHearingRequestSchema,
} from "./index.js";

describe("office date-times", () => {
  it.each(["2026-11-03T09:30", "2028-02-29T00:00", "2026-12-31T23:59"])("accepts %s", (value) => {
    expect(officeDateTimeSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "2026-02-30T09:30",
    "2027-02-29T09:30",
    "2026-11-03T24:00",
    "2026-11-03T09:60",
    "2026-11-03 09:30",
    "2026-11-03T09:30:00",
    "2026-11-03T09:30Z",
  ])("refuses %s", (value) => {
    expect(officeDateTimeSchema.safeParse(value).success).toBe(false);
  });
});

describe("tasks", () => {
  it("needs a date for a deadline but not for a task", () => {
    expect(createTaskRequestSchema.safeParse({ kind: "deadline", title: "Appel" }).success).toBe(
      false,
    );
    expect(
      createTaskRequestSchema.safeParse({ kind: "deadline", title: "Appel", dueOn: null }).success,
    ).toBe(false);
    expect(createTaskRequestSchema.safeParse({ kind: "task", title: "Appeler" }).success).toBe(
      true,
    );
  });

  it("refuses fields the server owns", () => {
    for (const extra of [
      { completedAt: "2026-01-01T00:00:00Z" },
      { matterId: "x" },
      { createdById: "x" },
    ]) {
      expect(
        createTaskRequestSchema.safeParse({ kind: "task", title: "x", ...extra }).success,
      ).toBe(false);
    }
  });
});

describe("hearings and agenda", () => {
  it("refuses empty updates and unknown statuses", () => {
    expect(updateHearingRequestSchema.safeParse({}).success).toBe(false);
    expect(updateHearingRequestSchema.safeParse({ status: "won" }).success).toBe(false);
  });

  it("limits the agenda to 92 days, in order", () => {
    expect(agendaQuerySchema.safeParse({ from: "2026-01-01", to: "2026-04-03" }).success).toBe(
      true,
    );
    expect(agendaQuerySchema.safeParse({ from: "2026-01-01", to: "2026-04-04" }).success).toBe(
      false,
    );
    expect(agendaQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(
      false,
    );
  });
});
