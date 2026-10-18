import {
  loginResponseSchema,
  recoveryCodesResponseSchema,
  revokedSessionsResponseSchema,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { send } from "@/lib/api";
import { MfaSetup, RecoveryCodes } from "@/features/auth/mfa-setup";
import { ReauthCancelled, useSensitiveAction } from "@/features/auth/reauth";
import { useRefreshSession, useSession } from "@/features/auth/session";
import { useErrorMessage } from "@/features/auth/use-error-message";

function ChangePassword() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const refreshSession = useRefreshSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const change = useMutation({
    mutationFn: () =>
      send(
        "POST",
        "/api/auth/password/change",
        { currentPassword, newPassword },
        loginResponseSchema,
      ),
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      await refreshSession();
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    change.mutate();
  };

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">{t("security.passwordTitle")}</h2>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {change.isSuccess && <Alert tone="success">{t("security.passwordChanged")}</Alert>}
        {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
        <Field label={t("security.currentPassword")}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("security.newPassword")} hint={t("password.hint")}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" disabled={change.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function OtherDevices() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const revoke = useMutation({
    mutationFn: () =>
      send("POST", "/api/auth/sessions/revoke-others", undefined, revokedSessionsResponseSchema),
  });
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("security.sessionsTitle")}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">{t("security.sessionsDescription")}</p>
      {revoke.isSuccess && (
        <div className="mb-4">
          <Alert tone="success">
            {t("security.signedOutOthers", { count: revoke.data.revoked })}
          </Alert>
        </div>
      )}
      {revoke.isError && (
        <div className="mb-4">
          <Alert tone="danger">{errorMessage(revoke.error)}</Alert>
        </div>
      )}
      <Button
        variant="outline"
        disabled={revoke.isPending}
        onClick={() => {
          revoke.mutate();
        }}
      >
        {t("security.signOutOthers")}
      </Button>
    </Card>
  );
}

function SecondFactor() {
  const { t } = useTranslation();
  const session = useSession();
  const refreshSession = useRefreshSession();
  const sensitive = useSensitiveAction();
  const errorMessage = useErrorMessage();
  const [settingUp, setSettingUp] = useState(false);
  const user = session.data?.user;

  const regenerate = useMutation({
    mutationFn: () =>
      sensitive(() =>
        send("POST", "/api/auth/mfa/recovery-codes", undefined, recoveryCodesResponseSchema),
      ),
  });
  const disable = useMutation({
    mutationFn: () => sensitive(() => send("DELETE", "/api/auth/mfa/totp")),
    onSuccess: () => refreshSession(),
  });
  const failure = [regenerate, disable].find(
    (m) => m.isError && !(m.error instanceof ReauthCancelled),
  );

  if (!user) return null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("security.mfaTitle")}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        {user.mfaEnabled ? t("security.mfaOn") : t("security.mfaOff")}
      </p>
      {failure && (
        <div className="mb-4">
          <Alert tone="danger">{errorMessage(failure.error)}</Alert>
        </div>
      )}
      {disable.isSuccess && !user.mfaEnabled && (
        <div className="mb-4">
          <Alert tone="success">{t("security.disabled")}</Alert>
        </div>
      )}
      {regenerate.data ? (
        <RecoveryCodes
          codes={regenerate.data.recoveryCodes}
          onDone={() => {
            regenerate.reset();
          }}
        />
      ) : settingUp ? (
        <MfaSetup
          onComplete={() => {
            setSettingUp(false);
            void refreshSession();
          }}
          onCancel={() => {
            setSettingUp(false);
          }}
        />
      ) : user.mfaEnabled ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              regenerate.mutate();
            }}
          >
            {t("security.regenerate")}
          </Button>
          {user.role === "admin" ? (
            <p className="text-sm text-muted sm:self-center">{t("security.adminMustKeep")}</p>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                disable.mutate();
              }}
            >
              {t("security.disable")}
            </Button>
          )}
        </div>
      ) : (
        <Button
          onClick={() => {
            setSettingUp(true);
          }}
        >
          {t("security.enable")}
        </Button>
      )}
    </Card>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-2xl">
      <PageHeader title={t("security.title")} description={t("security.description")} />
      <div className="space-y-6">
        <ChangePassword />
        <SecondFactor />
        <OtherDevices />
      </div>
    </section>
  );
}
