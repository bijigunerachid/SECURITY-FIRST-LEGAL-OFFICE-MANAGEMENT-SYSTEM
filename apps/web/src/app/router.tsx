import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { BreakGlassPage } from "@/features/admin/break-glass-page";
import { UsersPage } from "@/features/admin/users-page";
import {
  RedirectIfSignedIn,
  RequireAdmin,
  RequireRole,
  RequireSession,
} from "@/features/auth/guards";
import { LoginPage } from "@/features/auth/login-page";
import { SetPasswordPage } from "@/features/auth/set-password-page";
import { SetupMfaPage } from "@/features/auth/setup-mfa-page";
import { VerifyPage } from "@/features/auth/verify-page";
import { HomePage } from "@/features/home/home-page";
import { ClientPage } from "@/features/matters/client-page";
import { ClientsPage } from "@/features/matters/clients-page";
import { ConflictsPage } from "@/features/matters/conflicts-page";
import { MatterPage } from "@/features/matters/matter-page";
import { MattersPage } from "@/features/matters/matters-page";
import { NewMatterPage } from "@/features/matters/new-matter-page";
import { SecurityPage } from "@/features/security/security-page";
import { StatusPage } from "@/features/status/status-page";
import { NotFoundPage } from "@/routes/not-found";
import { RouteErrorPage } from "@/routes/route-error";

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <RedirectIfSignedIn />,
        children: [{ path: "login", element: <LoginPage /> }],
      },
      { path: "login/verify", element: <VerifyPage /> },
      { path: "setup-mfa", element: <SetupMfaPage /> },
      { path: "set-password", element: <SetPasswordPage /> },
      {
        element: <RequireSession />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "security", element: <SecurityPage /> },
          { path: "matters", element: <MattersPage /> },
          {
            path: "matters/new",
            element: (
              <RequireRole roles={["lawyer"]}>
                <NewMatterPage />
              </RequireRole>
            ),
          },
          { path: "matters/:matterId", element: <MatterPage /> },
          {
            path: "clients",
            element: (
              <RequireRole roles={["lawyer", "assistant"]}>
                <ClientsPage />
              </RequireRole>
            ),
          },
          { path: "clients/:clientId", element: <ClientPage /> },
          {
            path: "conflicts",
            element: (
              <RequireRole roles={["lawyer"]}>
                <ConflictsPage />
              </RequireRole>
            ),
          },
          {
            path: "admin/users",
            element: (
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            ),
          },
          {
            path: "admin/break-glass",
            element: (
              <RequireAdmin>
                <BreakGlassPage />
              </RequireAdmin>
            ),
          },
          { path: "status", element: <StatusPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
