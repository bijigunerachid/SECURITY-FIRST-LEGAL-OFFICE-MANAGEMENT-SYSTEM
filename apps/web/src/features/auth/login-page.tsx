import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema, loginResponseSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { send } from "@/lib/api";
import { useRefreshSession } from "./session";
import { useErrorMessage } from "./use-error-message";

type LoginForm = z.input<typeof loginRequestSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const refreshSession = useRefreshSession();
  const errorMessage = useErrorMessage();
  const signedOut = (location.state as { signedOut?: boolean } | null)?.signedOut === true;
  const from = (location.state as { from?: string } | null)?.from;

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  const login = useMutation({
    mutationFn: (values: LoginForm) => send("POST", "/api/auth/login", values, loginResponseSchema),
    onSuccess: async ({ state }) => {
      await refreshSession();
      if (state === "mfa_pending") await navigate("/login/verify", { replace: true });
      else if (state === "mfa_setup_required") await navigate("/setup-mfa", { replace: true });
      // Only return to an in-app path, never to an outside address.
      else
        await navigate(from?.startsWith("/") && !from.startsWith("//") ? from : "/", {
          replace: true,
        });
    },
    onError: () => {
      form.resetField("password");
    },
  });

  return (
    <section className="mx-auto max-w-md" aria-labelledby="page-title">
      <PageHeader title={t("login.title")} description={t("login.description")} />
      <Card>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              login.mutate(values);
            })(event);
          }}
        >
          {signedOut && !login.isError && <Alert tone="success">{t("login.signedOut")}</Alert>}
          {login.isError && <Alert tone="danger">{errorMessage(login.error)}</Alert>}
          <Field
            label={t("login.email")}
            error={form.formState.errors.email ? t("errors.invalid_credentials") : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="username"
                inputMode="email"
                dir="ltr"
                {...form.register("email")}
              />
            )}
          </Field>
          <Field label={t("login.password")}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {t("login.submit")}
          </Button>
          <p className="text-sm text-muted">{t("login.forgot")}</p>
        </form>
      </Card>
    </section>
  );
}
