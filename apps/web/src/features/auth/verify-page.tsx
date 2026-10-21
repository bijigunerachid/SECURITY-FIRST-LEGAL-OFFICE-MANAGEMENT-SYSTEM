import { loginResponseSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { send } from "@/lib/api";
import { useForgetEverything, useRefreshSession, useSession } from "./session";
import { useErrorMessage } from "./use-error-message";

/** Second step of sign-in: authenticator code, or a single-use recovery code. */
export function VerifyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const refreshSession = useRefreshSession();
  const forgetEverything = useForgetEverything();
  const errorMessage = useErrorMessage();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");

  const verify = useMutation({
    mutationFn: (input: { code: string } | { recoveryCode: string }) =>
      send("POST", "/api/auth/mfa/verify", input, loginResponseSchema),
    onSuccess: async () => {
      await refreshSession();
      await navigate("/", { replace: true });
    },
    onError: () => {
      setValue("");
    },
  });

  const cancel = useMutation({
    mutationFn: () => send("POST", "/api/auth/logout"),
    onSettled: async () => {
      forgetEverything();
      await navigate("/login", { replace: true });
    },
  });

  if (!session.isPending && session.data?.state !== "mfa_pending") {
    return <Navigate to={session.data ? "/" : "/login"} replace />;
  }

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;
    verify.mutate(useRecovery ? { recoveryCode: trimmed } : { code: trimmed.replace(/\s/g, "") });
  };

  return (
    <section className="mx-auto max-w-md" aria-labelledby="page-title">
      <PageHeader title={t("verify.title")} description={t("verify.description")} />
      <Card>
        <form noValidate className="space-y-5" onSubmit={submit}>
          {verify.isError && <Alert tone="danger">{errorMessage(verify.error)}</Alert>}
          {useRecovery ? (
            <Field label={t("verify.recoveryCode")} hint={t("verify.recoveryHint")}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  dir="ltr"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                  }}
                />
              )}
            </Field>
          ) : (
            <Field label={t("verify.code")}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  dir="ltr"
                  className="text-center text-xl tracking-[0.5em]"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                  }}
                />
              )}
            </Field>
          )}
          <Button type="submit" className="w-full" disabled={verify.isPending}>
            {t("verify.submit")}
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setValue("");
                verify.reset();
              }}
            >
              {useRecovery ? t("verify.useCode") : t("verify.useRecovery")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                cancel.mutate();
              }}
            >
              {t("verify.cancel")}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
