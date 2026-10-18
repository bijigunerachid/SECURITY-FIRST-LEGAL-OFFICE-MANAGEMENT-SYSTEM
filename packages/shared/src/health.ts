import { z } from "zod";

/**
 * Health responses deliberately carry no version numbers, host names or
 * dependency details, so they reveal nothing useful to an attacker.
 */
export const livenessResponseSchema = z.strictObject({
  status: z.literal("ok"),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = z.strictObject({
  status: z.enum(["ok", "unavailable"]),
  checks: z.strictObject({
    database: z.enum(["ok", "unavailable"]),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
