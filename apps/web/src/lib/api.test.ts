import { livenessResponseSchema } from "@lexora/shared";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse } from "@/test/render";
import { ApiError, getJson } from "./api";

describe("getJson", () => {
  it("returns validated data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" })));
    await expect(getJson("/api/health/live", livenessResponseSchema)).resolves.toEqual({
      status: "ok",
    });
  });

  it("turns the shared error shape into an ApiError with code and request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { error: { code: "not_found", requestId: "req-1" } })),
    );
    await expect(getJson("/api/health/live", livenessResponseSchema)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      requestId: "req-1",
    });
  });

  it("reports network failures without leaking the underlying error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("connect ECONNREFUSED 10.0.0.5:3000")),
    );
    const error = await getJson("/api/health/live", livenessResponseSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: null, code: "network_error" });
    expect(String(error)).not.toContain("10.0.0.5");
  });

  it("rejects non-JSON responses (for example an HTML error page from a proxy)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    await expect(getJson("/api/health/live", livenessResponseSchema)).rejects.toMatchObject({
      status: 502,
      code: "invalid_response",
    });
  });

  it("rejects successful responses with an unexpected shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", extra: true })),
    );
    await expect(getJson("/api/health/live", livenessResponseSchema)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("sends credentials only to the same origin and aborts after the timeout", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getJson("/api/health/live", livenessResponseSchema, { timeoutMs: 20 }),
    ).rejects.toMatchObject({
      code: "network_error",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
  });
});
