import { describe, expect, it } from "vitest";
import { memoryLogger } from "../test/helpers.js";

describe("logger redaction", () => {
  it("removes secrets at the top level and one level deep", () => {
    const { logger, lines, raw } = memoryLogger();

    logger.info(
      {
        password: "hunter2-password",
        token: "reset-token-value",
        user: { password: "nested-password", token: "nested-token", code: "123456" },
        databaseUrl: "postgresql://lexora_app:db-secret@db/lexora",
      },
      "test event",
    );

    const output = raw();
    for (const secret of [
      "hunter2-password",
      "reset-token-value",
      "nested-password",
      "nested-token",
      "123456",
      "db-secret",
    ]) {
      expect(output).not.toContain(secret);
    }
    const [line] = lines();
    expect(line?.["password"]).toBe("[Redacted]");
    expect((line?.["user"] as Record<string, unknown>)["token"]).toBe("[Redacted]");
  });

  it("removes cookies and authorization headers from request objects", () => {
    const { logger, raw } = memoryLogger();
    logger.info(
      {
        req: {
          headers: {
            cookie: "__Host-lexora_session=session-secret",
            authorization: "Bearer bearer-secret",
            "x-csrf-token": "csrf-secret",
          },
        },
        res: { headers: { "set-cookie": "__Host-lexora_session=new-session-secret" } },
      },
      "request",
    );
    const output = raw();
    expect(output).not.toContain("session-secret");
    expect(output).not.toContain("bearer-secret");
    expect(output).not.toContain("csrf-secret");
  });

  it("uses a readable level label and an ISO timestamp", () => {
    const { logger, lines } = memoryLogger();
    logger.warn("something");
    const [line] = lines();
    expect(line?.["level"]).toBe("warn");
    expect(typeof line?.["time"]).toBe("string");
    expect(line?.["service"]).toBe("lexora-api");
  });
});
