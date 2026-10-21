import type { ConflictHit } from "@lexora/shared";
import { Lock, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/feedback";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { MatterStatusBadge } from "./matter-ui";
import { useConflictSearch } from "./queries";

function HitRow({ hit }: { hit: ConflictHit }) {
  const { t } = useTranslation();
  const role =
    hit.matchedAs === "client" ? t("conflicts.asClient") : t(`partyRoles.${hit.matchedAs}`);
  const hidden = hit.matchedName === null;
  return (
    <li className="space-y-1 p-4">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {hidden ? (
          <>
            <Lock className="size-4 text-danger" aria-hidden="true" />
            {t("conflicts.restrictedHit")}
          </>
        ) : (
          hit.matchedName
        )}
        <span className="text-sm font-normal text-muted">· {role}</span>
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {hit.matter === null && <span>{t("conflicts.noMatter")}</span>}
        {hit.matter?.reference && (
          <span dir="ltr" className="font-mono">
            {hit.matter.reference}
          </span>
        )}
        {hit.matter?.status && <MatterStatusBadge status={hit.matter.status} />}
        {hit.contact && <span>{t("conflicts.contact", { name: hit.contact })}</span>}
        {hit.matter?.id && (
          <Link
            to={`/matters/${hit.matter.id}`}
            className="inline-flex min-h-11 items-center text-ink underline decoration-accent decoration-2 underline-offset-4"
          >
            {t("conflicts.open")}
          </Link>
        )}
      </p>
    </li>
  );
}

/**
 * Runs the conflict search for `q` (null: nothing searched yet) and shows the
 * hits. `onDone` is told which text was searched once results arrive.
 */
export function ConflictResults({ q, onDone }: { q: string | null; onDone?: (q: string) => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const search = useConflictSearch(q);

  useEffect(() => {
    if (q !== null && search.isSuccess) onDone?.(q);
  }, [q, search.isSuccess, onDone]);

  if (q === null) return null;
  if (search.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t("common.loading")}
      </p>
    );
  }
  if (search.isError) return <Alert tone="danger">{errorMessage(search.error)}</Alert>;

  const { hits, truncated } = search.data;
  return (
    <div className="space-y-3" aria-live="polite">
      <p className="text-sm font-medium" role="status">
        {hits.length === 0
          ? t("conflicts.checkedNone", { q })
          : t("conflicts.results", { count: hits.length, q })}
      </p>
      {truncated && <Alert tone="info">{t("conflicts.truncated")}</Alert>}
      {hits.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {hits.map((hit, index) => (
            // Hits have no ID of their own; their order is fixed for one search.
            <HitRow key={index} hit={hit} />
          ))}
        </ul>
      )}
    </div>
  );
}
