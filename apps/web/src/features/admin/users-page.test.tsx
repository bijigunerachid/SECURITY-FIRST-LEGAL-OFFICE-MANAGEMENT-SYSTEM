import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, jsonResponse, mockApi, renderRoute, signedIn } from "@/test/render";

const admin = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin" as const,
  mfaEnabled: true,
  displayName: "Office Owner",
};

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: "22222222-2222-4222-8222-222222222222",
  email: "nadia@cabinet.test",
  displayName: "Nadia Benali",
  role: "assistant",
  disabled: false,
  mfaEnabled: false,
  hasPassword: true,
  createdAt: "2026-10-01T09:00:00.000Z",
  lastActiveAt: null,
  ...overrides,
});

describe("users page", () => {
  it("lists users with role, status and second-factor state", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(admin),
      "GET /api/admin/users": jsonResponse(200, {
        users: [
          userRow(),
          userRow({
            id: "33333333-3333-4333-8333-333333333333",
            displayName: "Omar",
            email: "omar@cabinet.test",
            disabled: true,
          }),
        ],
      }),
    });
    renderRoute("/admin/users");
    expect(await screen.findByText("Nadia Benali")).toBeInTheDocument();
    expect(screen.getByText("Désactivé")).toBeInTheDocument();
    expect(screen.getAllByText("Assistant").length).toBeGreaterThan(0);
  });

  it("asks for the password and code when the server requires it, then retries and shows the link once", async () => {
    const created = {
      user: userRow({ hasPassword: false }),
      setup: { token: "T".repeat(43), expiresAt: "2026-10-18T12:30:00.000Z" },
    };
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(admin),
      "GET /api/admin/users": jsonResponse(200, { users: [] }),
      "POST /api/admin/users": [
        apiError(403, "reauthentication_required"),
        jsonResponse(201, created),
      ],
      "POST /api/auth/reauth": jsonResponse(204, null),
    });
    renderRoute("/admin/users");

    await userEvent.click(await screen.findByRole("button", { name: "Ajouter un utilisateur" }));
    const createDialog = await screen.findByRole("dialog", { name: "Nouvel utilisateur" });
    await userEvent.type(within(createDialog).getByLabelText("Nom"), "Nadia Benali");
    await userEvent.type(within(createDialog).getByLabelText("E-mail"), "nadia@cabinet.test");
    await userEvent.selectOptions(within(createDialog).getByLabelText("Rôle"), "assistant");
    await userEvent.click(within(createDialog).getByRole("button", { name: "Créer le compte" }));

    const reauth = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    await userEvent.type(
      within(reauth).getByLabelText("Mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.type(within(reauth).getByLabelText("Code de vérification"), "123456");
    await userEvent.click(within(reauth).getByRole("button", { name: "Confirmer" }));

    const link = await screen.findByTestId("password-link");
    expect(link.textContent).toBe(`${window.location.origin}/set-password#token=${"T".repeat(43)}`);
    expect(
      requests.filter((r) => r.path === "/api/admin/users" && r.method === "POST"),
    ).toHaveLength(2);
    expect(requests.find((r) => r.path === "/api/auth/reauth")?.body).toEqual({
      password: "olive tree beside the old harbour",
      code: "123456",
    });
  });

  it("does not offer role changes or disabling for the administrator's own account", async () => {
    mockApi({
      "GET /api/auth/session": signedIn(admin),
      "GET /api/admin/users": jsonResponse(200, {
        users: [userRow({ id: admin.id, displayName: "Office Owner", role: "admin" })],
      }),
    });
    renderRoute("/admin/users");
    await userEvent.click(await screen.findByRole("button", { name: "Actions pour Office Owner" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Changer le rôle")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Désactiver le compte" }),
    ).not.toBeInTheDocument();
  });

  it("asks for confirmation before disabling an account", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(admin),
      "GET /api/admin/users": jsonResponse(200, { users: [userRow()] }),
      "PATCH /api/admin/users/22222222-2222-4222-8222-222222222222": jsonResponse(204, null),
    });
    renderRoute("/admin/users");
    await userEvent.click(await screen.findByRole("button", { name: "Actions pour Nadia Benali" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Désactiver le compte" }));
    expect(within(dialog).getByText(/Toutes ses sessions seront fermées/)).toBeInTheDocument();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Continuer" }));
    expect(await within(dialog).findByText("Modification enregistrée.")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ disabled: true });
  });
});
