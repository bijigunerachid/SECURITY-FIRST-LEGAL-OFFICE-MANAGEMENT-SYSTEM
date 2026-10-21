import { updateClientRequestSchema, type ClientDetail } from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { FolderPlus, Pencil } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { isApiError, send } from "@/lib/api";
import { ClientFields, clientBody, type ClientFormValues } from "./client-fields";
import { Detail, MatterListItem, NotFoundNotice } from "./matter-ui";
import { invalidFields, useClient, useInvalidateMatters } from "./queries";

function EditClientDialog({ client, onClose }: { client: ClientDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [values, setValues] = useState<ClientFormValues>({
    kind: client.kind,
    name: client.name,
    identifier: client.identifier ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    notes: client.notes ?? "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const save = useMutation({
    mutationFn: (body: object) => send("PATCH", `/api/clients/${client.id}`, body),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, "validation_failed")) setInvalid(new Set(error.fields));
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    // The kind (person or company) is fixed once recorded.
    const { kind: _kind, ...body } = clientBody(values);
    const nextInvalid = invalidFields(updateClientRequestSchema.safeParse(body).error);
    setInvalid(nextInvalid);
    if (nextInvalid.size === 0) save.mutate(body);
  };

  return (
    <Dialog open onClose={onClose} title={t("clients.edit")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <ClientFields values={values} onChange={setValues} invalid={invalid} withKind={false} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ClientPage() {
  const { t } = useTranslation();
  const { clientId = "" } = useParams();
  const errorMessage = useErrorMessage();
  const query = useClient(clientId);
  const [editing, setEditing] = useState(false);

  if (query.isPending) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  if (query.isError) {
    if (isApiError(query.error, "not_found")) {
      return (
        <NotFoundNotice
          title={t("clients.notFoundTitle")}
          body={t("clients.notFoundBody")}
          backTo="/clients"
          backLabel={t("clients.backToList")}
        />
      );
    }
    return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  }

  const { client } = query.data;
  return (
    <article aria-labelledby="page-title" className="space-y-8">
      <header className="space-y-3">
        <Link
          to="/clients"
          className="inline-flex min-h-11 items-center text-sm text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          {t("clients.backToList")}
        </Link>
        <h1
          id="page-title"
          className="text-2xl font-semibold tracking-tight break-words sm:text-3xl"
        >
          {client.name}
        </h1>
        <Badge>{t(`clientKinds.${client.kind}`)}</Badge>
      </header>

      <Section
        title={t("clients.contact")}
        actions={
          client.permissions.update && (
            <Button
              variant="outline"
              onClick={() => {
                setEditing(true);
              }}
            >
              <Pencil className="size-4" aria-hidden="true" />
              {t("clients.edit")}
            </Button>
          )
        }
      >
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label={t("clients.identifier")}>
              <span dir="ltr">{client.identifier ?? "—"}</span>
            </Detail>
            <Detail label={t("clients.email")}>
              <span dir="ltr">{client.email ?? "—"}</span>
            </Detail>
            <Detail label={t("clients.phone")}>
              <span dir="ltr">{client.phone ?? "—"}</span>
            </Detail>
            <Detail label={t("clients.address")}>{client.address ?? "—"}</Detail>
            <Detail label={t("clients.notes")} className="sm:col-span-2">
              {client.notes ?? "—"}
            </Detail>
          </dl>
        </Card>
      </Section>

      <Section
        title={t("clients.matters")}
        actions={
          client.permissions.openMatter && (
            <Link
              to={`/matters/new?client=${client.id}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              {t("clients.openMatter")}
            </Link>
          )
        }
      >
        {client.matters.length === 0 ? (
          <p className="text-sm text-muted">{t("clients.noMatter")}</p>
        ) : (
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {client.matters.map((matter) => (
                <MatterListItem key={matter.id} matter={matter} />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {editing && (
        <EditClientDialog
          client={client}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </article>
  );
}
