import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Providers } from "@/app/providers";
import { routes } from "@/app/router";
import { createI18n, type Language } from "@/i18n";

/** Renders the real route tree at `path`, with fresh query and i18n state. */
export function renderRoute(path = "/", language: Language = "fr") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const i18n = createI18n(language);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers i18n={i18n} queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, i18n, router };
}

/** Replaces fetch with one that answers every call with the given response. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
