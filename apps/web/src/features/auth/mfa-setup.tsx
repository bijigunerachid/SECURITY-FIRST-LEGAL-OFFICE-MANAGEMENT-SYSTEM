import { recoveryCodesResponseSchema, totpSetupResponseSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { send } from "@/lib/api";
import { QrCode } from "./qr-code";
import { ReauthCancelled, useSensitiveAction } from "./reauth";
import { useErrorMessage } from "./use-error-message";

/** Shows recovery codes once, with download and copy, and asks the user to confirm they saved them. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = `${t("mfa.fileHeader")}\n\n${codes.join("\n")}\n`;

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "lexora-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Alert tone="info" title={t("mfa.recoveryTitle")}>
        {t("mfa.recoveryDescription")}
      </Alert>
      <ol
        className="grid grid-cols-1 gap-2 font-mono text-base sm:grid-cols-2"
        dir="ltr"
        aria-label={t("mfa.recoveryTitle")}
      >
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-md border border-border bg-surface-muted px-3 py-2 text-center"
          >
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={download}>
          {t("mfa.download")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <Button className="w-full" onClick={onDone}>
        {t("mfa.saved")}
      </Button>
    </div>
  );
}

/**
 * Authenticator enrolment: show QR code and key, check a first code, then
 * show the recovery codes. Used both for the mandatory administrator set-up
 * and from the security page.
 */
export function MfaSetup({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const sensitive = useSensitiveAction();
  const [code, setCode] = useState("");

  const start = useMutation({
    // A signed-in user must confirm their password first; an administrator in
    // mandatory set-up is not asked (the server decides).
    mutationFn: () =>
      sensitive(() => send("POST", "/api/auth/mfa/totp/setup", undefined, totpSetupResponseSchema)),
    onError: (error) => {
      if (error instanceof ReauthCancelled) onCancel?.();
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      send("POST", "/api/auth/mfa/totp/confirm", { code }, recoveryCodesResponseSchema),
    onError: () => {
      setCode("");
    },
  });

  // Exactly one set-up request, even when React runs effects twice in
  // development: a second request would replace the secret shown in the QR code.
  const started = useRef(false);
  const { mutate: startSetup } = start;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startSetup();
  }, [startSetup]);

  if (confirm.data) {
    return <RecoveryCodes codes={confirm.data.recoveryCodes} onDone={onComplete} />;
  }
  if (start.isError) {
    return <Alert tone="danger">{errorMessage(start.error)}</Alert>;
  }
  if (!start.data) {
    return <p className="text-sm text-muted">{t("common.loading")}</p>;
  }

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) confirm.mutate();
  };

  return (
    <div className="space-y-6">
      <ol className="list-decimal space-y-4 ps-5 text-sm">
        <li>{t("mfa.step1")}</li>
        <li className="space-y-3">
          <p>{t("mfa.step2")}</p>
          <QrCode value={start.data.uri} label={t("mfa.qrLabel")} />
          <p className="text-muted">{t("mfa.manual")}</p>
          <code
            dir="ltr"
            data-testid="totp-secret"
            className="block break-all rounded-md bg-surface-muted px-3 py-2 font-mono text-sm"
          >
            {start.data.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        </li>
        <li>{t("mfa.step3")}</li>
      </ol>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {confirm.isError && <Alert tone="danger">{errorMessage(confirm.error)}</Alert>}
        <Field label={t("verify.code")}>
          {(props) => (
            <Input
              {...props}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              dir="ltr"
              className="text-center text-xl tracking-[0.5em]"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
              }}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={confirm.isPending}>
          {t("mfa.confirm")}
        </Button>
      </form>
    </div>
  );
}
