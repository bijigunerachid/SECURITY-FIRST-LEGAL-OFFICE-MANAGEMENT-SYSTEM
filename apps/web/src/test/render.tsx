import type { SessionResponse } from "@lexora/shared";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createQueryClient, Providers } from "@/app/providers";
import { routes } from "@/app/router";
import { setCsrfToken } from "@/lib/api";
import { createI18n, type Language } from "@/i18n";

/** Renders the real route tree at `path`, with fresh query and i18n state. */
export function renderRoute(path = "/", language: Language = "fr") {
  setCsrfToken(null);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false, gcTime: 0 },
  });
  const i18n = createI18n(language);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers i18n={i18n} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, i18n, router, queryClient };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const apiError = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  jsonResponse(status, { error: { code, requestId: "test-request", ...extra } });

export function sessionFor(
  overrides: Partial<SessionResponse["user"]> = {},
  state: SessionResponse["state"] = "active",
): SessionResponse {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "fatima@cabinet.test",
      displayName: "Fatima El Amrani",
      role: "lawyer",
      mfaEnabled: false,
      ...overrides,
    },
    state,
    csrfToken: "csrf-test-token",
    expiresAt: "2026-10-18T20:00:00.000Z",
    recentlyReauthenticated: false,
  };
}

type Handler = Response | ((init: RequestInit) => Response | Promise<Response>);

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Replaces fetch with a fake API answering by "METHOD /path". A handler may
 * be a list, used in order (the last one repeats). Unknown routes answer 404.
 */
export function mockApi(handlers: Record<string, Handler | Handler[]>) {
  const requests: RecordedRequest[] = [];
  const queues = new Map(
    Object.entries(handlers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? "GET";
    requests.push({
      method,
      path,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const queue = queues.get(`${method} ${path}`);
    if (!queue || queue.length === 0) return apiError(404, "not_found");
    const handler = queue.length > 1 ? queue.shift() : queue[0];
    const response = typeof handler === "function" ? await handler(init) : handler;
    // A Response body can be read once; hand out copies for repeated use.
    return response?.clone() ?? apiError(500, "internal_error");
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

export const signedOut = () => apiError(401, "unauthenticated");
export const signedIn = (overrides: Partial<SessionResponse["user"]> = {}) =>
  jsonResponse(200, sessionFor(overrides));
