import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, renderRoute } from "@/test/render";

const ready = { status: "ok", checks: { database: "ok" } };
const databaseDown = { status: "unavailable", checks: { database: "unavailable" } };

describe("StatusPage", () => {
  it("shows a loading state, then both checks as operational", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, ready)));
    renderRoute("/");

    expect(screen.getByText("Vérification en cours…")).toBeInTheDocument();
    expect(await screen.findAllByText("Opérationnel")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      "/api/health/ready",
      expect.objectContaining({ credentials: "same-origin", method: "GET" }),
    );
  });

  it("shows the database as unavailable when readiness answers 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, databaseDown)));
    renderRoute("/");

    expect(await screen.findByText("Indisponible")).toBeInTheDocument();
    expect(screen.getByText("Opérationnel")).toBeInTheDocument();
  });

  it("shows an error state with a working retry when the server cannot be reached", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(jsonResponse(200, ready));
    vi.stubGlobal("fetch", fetchMock);
    renderRoute("/");

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => {
      expect(screen.getAllByText("Opérationnel")).toHaveLength(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats an unexpected response shape as an error instead of trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", checks: { database: "maybe" } })),
    );
    renderRoute("/");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders in Arabic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, ready)));
    renderRoute("/", "ar");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("حالة النظام");
    expect(await screen.findAllByText("يعمل")).toHaveLength(2);
  });
});

describe("routing", () => {
  it("shows a not-found page for unknown paths", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRoute("/clients/123");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable");
    expect(screen.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
  });
});
