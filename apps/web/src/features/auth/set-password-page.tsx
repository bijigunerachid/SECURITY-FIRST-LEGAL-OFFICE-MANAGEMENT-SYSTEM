import { newPasswordSchema, passwordTokenSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { send } from "@/lib/api";
import { useForgetEverything } from "./session";
import { useErrorMessage } from "./use-error-message";

/**
 * Reads the single-use token from the URL fragment (#token=…). Fragments are
 * never sent to servers or in Referer headers. The token is then removed
 * from the address bar so it does not stay in the browser history.
 */
function takeTokenFromUrl(): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  const token = match?.[1] ?? null;
  if (token) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return passwordTokenSchema.safeParse(token).success ? token : null;
}

export function SetPasswordPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const forgetEverything = useForgetEverything();
  const [token] = useState(takeTokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const setNewPassword = useMutation({
    mutationFn: () => send("POST", "/api/auth/password/set", { token, password }),
    onSuccess: () => {
      // The server ended every session of this account; drop anything cached.
      forgetEverything();
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!newPasswordSchema.safeParse(password).success) {
      setLocalError(
        t(password.length < 15 ? "password.reasons.too_short" : "password.reasons.too_long"),
      );
      return;
    }
    if (password !== confirm) {
      setLocalError(t("setPassword.mismatch"));
      return;
    }
    setLocalError(null);
    setNewPassword.mutate();
  };

  return (
    <section className="mx-auto max-w-md" aria-labelledby="page-title">
      <PageHeader title={t("setPassword.title")} description={t("setPassword.description")} />
      <Card>
        {!token ? (
          <Alert tone="danger">{t("setPassword.missingToken")}</Alert>
        ) : setNewPassword.isSuccess ? (
          <div className="space-y-5">
            <Alert tone="success" title={t("setPassword.doneTitle")}>
              {t("setPassword.doneBody")}
            </Alert>
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-ink"
            >
              {t("setPassword.goToLogin")}
            </Link>
          </div>
        ) : (
          <form noValidate className="space-y-5" onSubmit={submit}>
            {setNewPassword.isError && (
              <Alert tone="danger">{errorMessage(setNewPassword.error)}</Alert>
            )}
            <Field
              label={t("setPassword.password")}
              hint={t("password.hint")}
              error={localError ?? undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={t("setPassword.confirm")}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                  }}
                />
              )}
            </Field>
            <Button type="submit" className="w-full" disabled={setNewPassword.isPending}>
              {t("setPassword.submit")}
            </Button>
          </form>
        )}
      </Card>
    </section>
  );
}
