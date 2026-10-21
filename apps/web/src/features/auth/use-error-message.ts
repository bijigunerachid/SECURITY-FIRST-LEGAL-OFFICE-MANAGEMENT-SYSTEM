import { useTranslation } from "react-i18next";
import { isApiError } from "@/lib/api";

/** Turns any error from an API call into a translated, user-facing sentence. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    if (!isApiError(error)) return t("errors.unexpected", { ref: "—" });
    switch (error.code) {
      case "password_rejected":
        return error.reason
          ? t(`password.reasons.${error.reason}`)
          : t("errors.unexpected", { ref: error.requestId ?? "—" });
      case "invalid_credentials":
      case "invalid_code":
      case "invalid_token":
      case "rate_limited":
      case "network_error":
      case "conflict":
      case "forbidden":
      case "not_found":
      case "validation_failed":
        return t(`errors.${error.code}`);
      case "unauthenticated":
        return t("errors.session_expired");
      default:
        return t("errors.unexpected", { ref: error.requestId ?? "—" });
    }
  };
}
