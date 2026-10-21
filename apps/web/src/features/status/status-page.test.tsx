import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";

const ready = { status: "ok", checks: { database: "ok" } };
const databaseDown = { status: "unavailable", checks: { database: "unavailable" } };

describe("StatusPage", () => {
  it("shows a loading state, then both checks as operational", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/health/ready": jsonResponse(200, ready),
    });
    renderRoute("/status");

    expect(await screen.findAllByText("Opérationnel")).toHaveLength(2);
    const health = requests.find((r) => r.path === "/api/health/ready");
    expect(health?.method).toBe("GET");
  });

  it("shows the database as unavailable when readiness answers 503", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/health/ready": jsonResponse(503, databaseDown),
    });
    renderRoute("/status");
    expect(await screen.findByText("Indisponible")).toBeInTheDocument();
    expect(screen.getByText("Opérationnel")).toBeInTheDocument();
  });

  it("shows an error state with a working retry when the server cannot be reached", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/health/ready": [apiError(502, "internal_error"), jsonResponse(200, ready)],
    });
    renderRoute("/status");
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => {
      expect(screen.getAllByText("Opérationnel")).toHaveLength(2);
    });
  });

  it("treats an unexpected response shape as an error instead of trusting it", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/health/ready": jsonResponse(200, { status: "ok", checks: { database: "maybe" } }),
    });
    renderRoute("/status");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders in Arabic", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(),
      "GET /api/health/ready": jsonResponse(200, ready),
    });
    renderRoute("/status", "ar");
    expect(
      await screen.findByRole("heading", { level: 1, name: "حالة النظام" }),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("يعمل")).toHaveLength(2);
  });
});

describe("routing", () => {
  it("shows a not-found page for unknown paths when signed in", async () => {
    mockApi({ "GET /api/auth/session": signedIn() });
    renderRoute("/archives/123");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable");
    expect(screen.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
  });
});
