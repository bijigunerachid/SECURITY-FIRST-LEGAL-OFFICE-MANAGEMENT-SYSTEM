import { useMutation } from "@tanstack/react-query";
import {
  createContext,
  use,
  useCallback,
  useRef,
  useState,
  type SyntheticEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Dialog } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { isApiError, send } from "@/lib/api";
import { useSession } from "./session";
import { useErrorMessage } from "./use-error-message";

type Run = <T>(action: () => Promise<T>) => Promise<T>;

const ReauthContext = createContext<Run | null>(null);

/** Raised when the user closes the confirmation dialog instead of confirming. */
export class ReauthCancelled extends Error {}

/**
 * Sensitive actions may answer "reauthentication_required". `useSensitiveAction`
 * then asks for the password (and code), confirms identity with the server and
 * retries the action once.
 */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const session = useSession();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const mfaEnabled = session.data?.user.mfaEnabled ?? false;

  const confirm = useMutation({
    mutationFn: () =>
      send("POST", "/api/auth/reauth", { password, ...(mfaEnabled ? { code } : {}) }),
    onSuccess: () => {
      setOpen(false);
      pending.current?.resolve();
      pending.current = null;
    },
    onSettled: () => {
      setPassword("");
      setCode("");
    },
  });

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        confirm.reset();
        setOpen(true);
      }),
    [confirm],
  );

  const run = useCallback<Run>(
    async (action) => {
      try {
        return await action();
      } catch (error) {
        if (!isApiError(error, "reauthentication_required")) throw error;
        await ask();
        return action();
      }
    },
    [ask],
  );

  const close = () => {
    setOpen(false);
    pending.current?.reject(new ReauthCancelled());
    pending.current = null;
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    confirm.mutate();
  };

  return (
    <ReauthContext value={run}>
      {children}
      <Dialog open={open} onClose={close} title={t("reauth.title")}>
        <form noValidate className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted">
            {mfaEnabled ? t("reauth.descriptionMfa") : t("reauth.description")}
          </p>
          {confirm.isError && <Alert tone="danger">{errorMessage(confirm.error)}</Alert>}
          <Field label={t("reauth.password")}>
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
              />
            )}
          </Field>
          {mfaEnabled && (
            <Field label={t("reauth.code")}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  dir="ltr"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ""));
                  }}
                />
              )}
            </Field>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={confirm.isPending}>
              {t("reauth.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </ReauthContext>
  );
}

export function useSensitiveAction(): Run {
  const run = use(ReauthContext);
  if (!run) throw new Error("useSensitiveAction must be used inside ReauthProvider");
  return run;
}
