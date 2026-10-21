import type { Role } from "@lexora/shared";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { useErrorMessage } from "./use-error-message";
import { useSession } from "./session";

function Loading() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {t("common.loading")}
    </p>
  );
}

/**
 * Shows its routes only to a fully signed-in user, and otherwise sends the
 * browser to the step it still needs. This is only for navigation: every
 * API route checks the session on the server.
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  const errorMessage = useErrorMessage();
  const { t } = useTranslation();

  if (session.isPending) return <Loading />;
  if (session.isError) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <Alert tone="danger">{errorMessage(session.error)}</Alert>
        <Button variant="outline" onClick={() => void session.refetch()}>
          {t("status.retry")}
        </Button>
      </div>
    );
  }
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.data.state === "mfa_pending") return <Navigate to="/login/verify" replace />;
  if (session.data.state === "mfa_setup_required") return <Navigate to="/setup-mfa" replace />;
  return <Outlet />;
}

/** For the sign-in pages: a signed-in user goes straight to the app. */
export function RedirectIfSignedIn() {
  const session = useSession();
  if (session.isPending) return <Loading />;
  if (session.data?.state === "active") return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Only for the given roles. Others see the same page as for a missing route.
 * Navigation only: the API enforces the same rule on every request.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const session = useSession();
  const role = session.data?.user.role;
  if (role === undefined || !roles.includes(role)) return <Navigate to="/not-found" replace />;
  return <>{children}</>;
}

/** Only for administrators. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  return <RequireRole roles={["admin"]}>{children}</RequireRole>;
}
