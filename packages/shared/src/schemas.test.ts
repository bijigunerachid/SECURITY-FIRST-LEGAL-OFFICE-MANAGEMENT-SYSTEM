import { describe, expect, it } from "vitest";
import { apiErrorResponseSchema, readinessResponseSchema } from "./index.js";

describe("shared response schemas", () => {
  it("rejects extra fields so responses cannot silently leak data", () => {
    const result = readinessResponseSchema.safeParse({
      status: "ok",
      checks: { database: "ok" },
      version: "1.2.3",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed validation error", () => {
    const result = apiErrorResponseSchema.safeParse({
      error: {
        code: "validation_failed",
        requestId: "6f1c1d8e-6d1e-4c39-8f5e-6a3e2b1d9c10",
        fields: [{ path: "name", issue: "too_small" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown error codes", () => {
    const result = apiErrorResponseSchema.safeParse({
      error: { code: "stack_trace", requestId: "x" },
    });
    expect(result.success).toBe(false);
  });
});
