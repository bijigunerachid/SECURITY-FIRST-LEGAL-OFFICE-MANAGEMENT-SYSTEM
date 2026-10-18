import { apiErrorResponseSchema } from "@lexora/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { memoryLogger } from "../../test/helpers.js";
import { HttpError } from "../errors.js";
import { errorHandler } from "./error-handler.js";
import { requestLogger } from "./request-logger.js";

function appThrowing(error: unknown) {
  const log = memoryLogger();
  const app = express();
  app.use(requestLogger(log.logger));
  app.use(express.json());
  app.post("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return { app, log };
}

describe("errorHandler", () => {
  it("hides unexpected errors behind a generic 500 but logs them", async () => {
    const { app, log } = appThrowing(
      new Error('relation "client" does not exist; password=db-secret'),
    );
    const res = await request(app).post("/boom").expect(500);

    expect(res.body).toEqual({
      error: { code: "internal_error", requestId: res.headers["x-request-id"] },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/relation|db-secret|stack|Error/);

    const logged = log.lines().find((line) => line["msg"] === "unhandled error");
    expect(logged?.["level"]).toBe("error");
    expect(JSON.stringify(logged)).toContain("relation");
  });

  it("passes through safe HTTP errors", async () => {
    const { app } = appThrowing(new HttpError(403, "forbidden", "internal detail"));
    const res = await request(app).post("/boom").expect(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(JSON.stringify(res.body)).not.toContain("internal detail");
  });

  it("lists failing field paths for validation errors, never the submitted values", async () => {
    const schema = z.strictObject({ name: z.string().min(2), email: z.email() });
    const result = schema.safeParse({ name: "x", email: "secret-but-invalid", role: "admin" });
    if (result.success) {
      throw new Error("expected validation to fail");
    }

    const { app } = appThrowing(result.error);
    const res = await request(app).post("/boom").expect(400);

    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.fields).toEqual(
      expect.arrayContaining([
        { path: "name", issue: "too_small" },
        { path: "email", issue: "invalid_format" },
        { path: "", issue: "unrecognized_keys" },
      ]),
    );
    expect(JSON.stringify(res.body)).not.toContain("secret-but-invalid");
    expect(JSON.stringify(res.body)).not.toContain("admin");
  });

  it.each([
    ["an unexpected error", new Error("internal")],
    ["a safe HTTP error", new HttpError(409, "conflict", "internal")],
    ["a validation error", z.strictObject({ a: z.string() }).safeParse({ a: 1, b: 2 }).error],
  ])("answers %s with exactly the shared error shape and nothing more", async (_name, error) => {
    const { app } = appThrowing(error);
    const res = await request(app).post("/boom");
    // The shared schema is strict: any extra field (a message, stack or
    // detail) makes this fail.
    expect(apiErrorResponseSchema.safeParse(res.body).success).toBe(true);
  });
});
