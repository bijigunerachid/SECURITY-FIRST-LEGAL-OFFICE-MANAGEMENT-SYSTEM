import { gzipSync } from "node:zlib";
import { apiErrorResponseSchema, readinessResponseSchema } from "@lexora/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { testApp, unreachableDatabase } from "../test/helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("security headers and caching", () => {
  it("sets restrictive headers on every API response", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/health/live").expect(200);

    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("applies the same headers to error responses", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/does-not-exist").expect(401);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("does not enable CORS", async () => {
    const { app } = testApp();
    const res = await request(app)
      .options("/api/health/live")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("request IDs", () => {
  it("returns a fresh random UUID and ignores any ID sent by the client", async () => {
    const { app } = testApp();
    const res = await request(app)
      .get("/api/health/live")
      .set("X-Request-Id", "attacker-chosen-id");
    expect(res.headers["x-request-id"]).toMatch(UUID);
    expect(res.headers["x-request-id"]).not.toBe("attacker-chosen-id");
  });

  it("puts the same ID in error bodies so support can find the log line", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/nope").expect(401);
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });
});

describe("health endpoints", () => {
  it("reports liveness without any detail", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/health/live").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("reports ready when the database is reachable", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/health/ready").expect(200);
    expect(readinessResponseSchema.parse(res.body)).toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("returns 503 when the database is unreachable", async () => {
    const { app } = testApp(unreachableDatabase);
    const res = await request(app).get("/api/health/ready").expect(503);
    expect(res.body).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
  });
});

describe("request bodies", () => {
  it("answers anonymous requests to unknown API routes with 401, so routes cannot be discovered", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/unknown").expect(401);
    expect(apiErrorResponseSchema.parse(res.body).error.code).toBe("unauthenticated");
    // Same answer as a real protected route.
    await request(app).get("/api/admin/users").expect(401);
  });

  it("answers unknown paths outside the API with the shared 404 shape", async () => {
    const { app } = testApp();
    const res = await request(app).get("/unknown").expect(404);
    expect(apiErrorResponseSchema.parse(res.body).error.code).toBe("not_found");
  });

  it("rejects malformed JSON with a generic 400", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/health/live")
      .set("Content-Type", "application/json")
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|JSON\.parse|position/i);
  });

  it("rejects JSON bodies over the size limit", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/health/live")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: "x".repeat(110 * 1024) }))
      .expect(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it.each(["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x"])(
    "rejects %s bodies with 415",
    async (contentType) => {
      const { app } = testApp();
      const res = await request(app)
        .post("/api/health/live")
        .set("Content-Type", contentType)
        .send("a=b")
        .expect(415);
      expect(res.body.error.code).toBe("unsupported_media_type");
    },
  );

  it.each(["gzip", "deflate", "br"])(
    "refuses %s-compressed bodies (never decompressed)",
    async (encoding) => {
      const { app } = testApp();
      const res = await request(app)
        .post("/api/health/live")
        .set("Content-Type", "application/json")
        .set("Content-Encoding", encoding)
        .send(gzipSync(JSON.stringify({ a: 1 })))
        .expect(415);
      expect(res.body.error.code).toBe("unsupported_media_type");
    },
  );

  it("allows bodiless POST requests to reach routing", async () => {
    const { app } = testApp();
    await request(app).post("/api/unknown").expect(401);
  });
});

describe("request logging", () => {
  it("logs method, path and status but not the query string or cookies", async () => {
    const { app, log } = testApp();
    await request(app)
      .get("/api/health/live?client=Fatima%20El%20Amrani")
      .set("Cookie", "__Host-lexora_session=session-secret");

    const output = log.raw();
    expect(output).not.toContain("Fatima");
    expect(output).not.toContain("session-secret");

    const completed = log.lines().find((line) => line["msg"] === "request completed");
    expect(completed?.["req"]).toEqual({
      id: expect.stringMatching(UUID),
      method: "GET",
      path: "/api/health/live",
    });
    expect(completed?.["res"]).toEqual({ statusCode: 200 });
  });
});
