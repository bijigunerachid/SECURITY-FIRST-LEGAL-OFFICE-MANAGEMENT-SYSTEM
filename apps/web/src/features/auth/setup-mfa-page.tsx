import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { MfaSetup } from "./mfa-setup";
import { useRefreshSession, useSession } from "./session";

/** Mandatory authenticator set-up for administrators who do not have one yet. */
export function SetupMfaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const refreshSession = useRefreshSession();

  if (session.isPending) return null;
  if (session.data?.state !== "mfa_setup_required") {
    return <Navigate to={session.data ? "/" : "/login"} replace />;
  }

  return (
    <section className="mx-auto max-w-lg" aria-labelledby="page-title">
      <PageHeader title={t("mfa.setupTitle")} />
      <div className="mb-6">
        <Alert tone="info">{t("mfa.setupRequired")}</Alert>
      </div>
      <Card>
        <MfaSetup
          onComplete={() => {
            void refreshSession().then(() => navigate("/", { replace: true }));
          }}
        />
      </Card>
    </section>
  );
}
