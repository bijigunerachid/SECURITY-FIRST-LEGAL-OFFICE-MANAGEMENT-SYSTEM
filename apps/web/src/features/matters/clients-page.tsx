import { clientResponseSchema, createClientRequestSchema } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, Dialog, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useSession } from "@/features/auth/session";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { isApiError, send } from "@/lib/api";
import { ClientFields, clientBody, emptyClient, type ClientFormValues } from "./client-fields";
import { ConflictResults } from "./conflict-results";
import { Pagination } from "./matter-ui";
import { invalidFields, useClientList, useInvalidateMatters } from "./queries";

/** Records a client without a matter (a prospect, or before the matter is described). */
function NewClientDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [values, setValues] = useState<ClientFormValues>(emptyClient);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [conflictQuery, setConflictQuery] = useState<string | null>(null);
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [needCheck, setNeedCheck] = useState(false);
  const name = values.name.trim();

  const create = useMutation({
    mutationFn: (body: object) => send("POST", "/api/clients", body, clientResponseSchema),
    onSuccess: async ({ client }) => {
      await invalidate();
      await navigate(`/clients/${client.id}`);
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = clientBody(values);
    const nextInvalid = invalidFields(createClientRequestSchema.safeParse(body).error);
    setInvalid(nextInvalid);
    const checked = checkedName !== null && checkedName === name;
    setNeedCheck(!checked);
    if (nextInvalid.size === 0 && checked) create.mutate(body);
  };

  return (
    <Dialog open onClose={onClose} title={t("clients.newTitle")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
        <ClientFields values={values} onChange={setValues} invalid={invalid} />
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Button
            variant="outline"
            disabled={name.length < 3}
            onClick={() => {
              setConflictQuery(name);
            }}
          >
            {t("conflicts.check")}
          </Button>
          <ConflictResults q={conflictQuery} onDone={setCheckedName} />
          {needCheck && checkedName !== name && (
            <Alert tone="danger">{t("matters.conflictRequired")}</Alert>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t("clients.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ClientsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const role = useSession().data?.user.role;
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const pageParam = Number(params.get("page") ?? "1");
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const clients = useClientList({ q, page });
  const [text, setText] = useState(q);
  const [creating, setCreating] = useState(false);

  const go = (next: { q?: string; page?: number }) => {
    const merged = new URLSearchParams(params);
    if (next.q !== undefined) {
      if (next.q) merged.set("q", next.q);
      else merged.delete("q");
    }
    if (next.page !== undefined) {
      if (next.page > 1) merged.set("page", String(next.page));
      else merged.delete("page");
    }
    setParams(merged);
  };

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={t("clients.title")} description={t("clients.description")} />
        {role === "lawyer" && (
          <Button
            className="shrink-0"
            onClick={() => {
              setCreating(true);
            }}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {t("clients.new")}
          </Button>
        )}
      </div>

      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: text.trim(), page: 1 });
        }}
      >
        <div className="flex-1">
          <Field label={t("clients.searchLabel")} hint={t("clients.searchHint")}>
            {(props) => (
              <Input
                {...props}
                type="search"
                maxLength={100}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="outline" className="sm:mt-7">
          {t("common.search")}
        </Button>
      </form>

      {clients.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {clients.isError && <Alert tone="danger">{errorMessage(clients.error)}</Alert>}
      {clients.data?.clients.length === 0 && (
        <p className="text-sm text-muted">{q ? t("clients.emptySearch") : t("clients.empty")}</p>
      )}
      {clients.data && clients.data.clients.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {clients.data.clients.map((client) => (
              <li key={client.id}>
                <Link
                  to={`/clients/${client.id}`}
                  className="flex flex-col gap-1 p-4 hover:bg-surface-muted sm:px-6"
                >
                  <span className="font-medium break-words">{client.name}</span>
                  <span className="flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>{t(`clientKinds.${client.kind}`)}</span>
                    {client.identifier && <span dir="ltr">{client.identifier}</span>}
                    <span>{t("clients.matterCount", { count: client.matterCount })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {clients.data && (
        <Pagination
          page={clients.data.page}
          hasMore={clients.data.hasMore}
          onPage={(next) => {
            go({ page: next });
          }}
        />
      )}
      {creating && (
        <NewClientDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}
