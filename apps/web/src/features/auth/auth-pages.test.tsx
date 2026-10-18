import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  jsonResponse,
  mockApi,
  renderRoute,
  sessionFor,
  signedIn,
  signedOut,
} from "@/test/render";

const VALID_TOKEN = "A".repeat(43);

describe("route guards", () => {
  it("sends signed-out visitors to the sign-in page", async () => {
    mockApi({ "GET /api/auth/session": signedOut() });
    const { router } = renderRoute("/security");
    expect(await screen.findByRole("heading", { level: 1, name: "Connexion" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("sends a session waiting for its code to the verification step", async () => {
    mockApi({ "GET /api/auth/session": jsonResponse(200, sessionFor({}, "mfa_pending")) });
    const { router } = renderRoute("/");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login/verify");
    });
  });

  it("sends an administrator without a second factor to mandatory set-up", async () => {
    mockApi({
      "GET /api/auth/session": jsonResponse(
        200,
        sessionFor({ role: "admin" }, "mfa_setup_required"),
      ),
      "POST /api/auth/mfa/totp/setup": jsonResponse(200, {
        secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        uri: "otpauth://totp/Lexora:a?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      }),
    });
    const { router } = renderRoute("/admin/users");
    expect(await screen.findByRole("img", { name: /Code QR/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/setup-mfa");
  });

  it("shows the not-found page, not the user list, to non-administrators", async () => {
    const { requests } = mockApi({ "GET /api/auth/session": signedIn({ role: "lawyer" }) });
    renderRoute("/admin/users");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Page introuvable" }),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.path === "/api/admin/users")).toBe(false);
  });
});

describe("sign-in page", () => {
  it("signs in and goes to the home page", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": [signedOut(), signedIn()],
      "POST /api/auth/login": jsonResponse(200, { state: "active" }),
    });
    renderRoute("/login");
    await userEvent.type(await screen.findByLabelText("Adresse e-mail"), "fatima@cabinet.test");
    await userEvent.type(
      screen.getByLabelText("Mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Bonjour, Fatima El Amrani" }),
    ).toBeInTheDocument();
    const login = requests.find((r) => r.path === "/api/auth/login");
    expect(login?.body).toEqual({
      email: "fatima@cabinet.test",
      password: "olive tree beside the old harbour",
    });
  });

  it("shows one generic message for wrong credentials and clears the password", async () => {
    mockApi({
      "GET /api/auth/session": signedOut(),
      "POST /api/auth/login": apiError(401, "invalid_credentials"),
    });
    renderRoute("/login");
    await userEvent.type(await screen.findByLabelText("Adresse e-mail"), "fatima@cabinet.test");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Adresse e-mail ou mot de passe incorrect.",
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  });

  it("explains rate limiting", async () => {
    mockApi({
      "GET /api/auth/session": signedOut(),
      "POST /api/auth/login": apiError(429, "rate_limited"),
    });
    renderRoute("/login");
    await userEvent.type(await screen.findByLabelText("Adresse e-mail"), "fatima@cabinet.test");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trop de tentatives");
  });

  it("continues to the code step when the account has a second factor", async () => {
    mockApi({
      "GET /api/auth/session": [
        signedOut(),
        jsonResponse(200, sessionFor({ mfaEnabled: true }, "mfa_pending")),
      ],
      "POST /api/auth/login": jsonResponse(200, { state: "mfa_pending" }),
    });
    const { router } = renderRoute("/login");
    await userEvent.type(await screen.findByLabelText("Adresse e-mail"), "fatima@cabinet.test");
    await userEvent.type(
      screen.getByLabelText("Mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Vérification en deux étapes" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login/verify");
  });
});

describe("set-password page", () => {
  it("reads the token from the URL fragment, then removes it from the address bar", async () => {
    window.history.replaceState(null, "", `/set-password#token=${VALID_TOKEN}`);
    const { requests } = mockApi({
      "GET /api/auth/session": signedOut(),
      "POST /api/auth/password/set": jsonResponse(204, null),
    });
    renderRoute("/set-password");
    expect(window.location.hash).toBe("");

    await userEvent.type(
      await screen.findByLabelText("Nouveau mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.type(
      screen.getByLabelText("Confirmer le mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));

    expect(await screen.findByText("Mot de passe enregistré")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      token: VALID_TOKEN,
      password: "olive tree beside the old harbour",
    });
  });

  it("checks length and confirmation before sending anything", async () => {
    window.history.replaceState(null, "", `/set-password#token=${VALID_TOKEN}`);
    const { requests } = mockApi({ "GET /api/auth/session": signedOut() });
    renderRoute("/set-password");
    await userEvent.type(await screen.findByLabelText("Nouveau mot de passe"), "too short");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(
      await screen.findByText("Le mot de passe doit contenir au moins 15 caractères."),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Nouveau mot de passe"));
    await userEvent.type(
      screen.getByLabelText("Nouveau mot de passe"),
      "olive tree beside the old harbour",
    );
    await userEvent.type(
      screen.getByLabelText("Confirmer le mot de passe"),
      "something else entirely",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(
      await screen.findByText("Les deux mots de passe ne correspondent pas."),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("explains which rule the server rejected", async () => {
    window.history.replaceState(null, "", `/set-password#token=${VALID_TOKEN}`);
    mockApi({
      "GET /api/auth/session": signedOut(),
      "POST /api/auth/password/set": apiError(400, "password_rejected", { reason: "common" }),
    });
    renderRoute("/set-password");
    await userEvent.type(await screen.findByLabelText("Nouveau mot de passe"), "passwordpassword");
    await userEvent.type(screen.getByLabelText("Confirmer le mot de passe"), "passwordpassword");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("listes de mots de passe divulgués");
  });

  it("says so when the link has no valid token", async () => {
    window.history.replaceState(null, "", "/set-password");
    mockApi({ "GET /api/auth/session": signedOut() });
    renderRoute("/set-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce lien est incomplet");
  });
});

describe("CSRF token", () => {
  it("is sent on state-changing requests only", async () => {
    const { requests } = mockApi({
      "GET /api/auth/session": signedIn(),
      "POST /api/auth/sessions/revoke-others": jsonResponse(200, { revoked: 2 }),
    });
    renderRoute("/security");
    await userEvent.click(
      await screen.findByRole("button", { name: "Déconnecter les autres appareils" }),
    );
    expect(await screen.findByText("2 autre(s) session(s) fermée(s).")).toBeInTheDocument();

    const post = requests.find((r) => r.method === "POST");
    expect(post?.headers["X-CSRF-Token"]).toBe("csrf-test-token");
    const get = requests.find((r) => r.method === "GET");
    expect(get?.headers["X-CSRF-Token"]).toBeUndefined();
  });
});
