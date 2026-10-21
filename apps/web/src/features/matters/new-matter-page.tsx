import {
  clientResponseSchema,
  createClientRequestSchema,
  createMatterRequestSchema,
  matterAreas,
  matterResponseSchema,
  type MatterArea,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader, Section } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { ApiError, send } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ClientFields, clientBody, emptyClient, type ClientFormValues } from "./client-fields";
import { ConflictResults } from "./conflict-results";
import {
  invalidFields,
  officeToday,
  useClient,
  useClientList,
  useInvalidateMatters,
} from "./queries";

interface MatterValues {
  title: string;
  area: MatterArea;
  openedOn: string;
  court: string;
  courtCaseNumber: string;
  description: string;
  restricted: boolean;
}

/** Raised when the client was recorded but the matter could not be opened. */
class MatterNotOpened extends Error {
  constructor(
    readonly clientId: string,
    readonly reason: unknown,
  ) {
    super("matter not opened");
  }
}

function ExistingClientPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState("");
  const selected = useClient(selectedId);
  const list = useClientList({ q, page: 1 }, selectedId === null);

  if (selectedId !== null) {
    return (
      <div className="space-y-2">
        {selected.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {selected.isError && <Alert tone="danger">{errorMessage(selected.error)}</Alert>}
        {selected.data && (
          <p className="font-medium" role="status">
            {t("matters.selectedClient", { name: selected.data.client.name })}
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => {
            onSelect(null);
          }}
        >
          {t("matters.changeClient")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Field label={t("matters.searchClient")}>
        {(props) => (
          <Input
            {...props}
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        )}
      </Field>
      {list.isError && <Alert tone="danger">{errorMessage(list.error)}</Alert>}
      {list.data?.clients.length === 0 && (
        <p className="text-sm text-muted">{t("matters.noClientFound")}</p>
      )}
      {list.data && list.data.clients.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.data.clients.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                className="flex min-h-11 w-full flex-col items-start gap-0.5 px-4 py-2 text-start hover:bg-surface-muted"
                onClick={() => {
                  onSelect(client.id);
                }}
              >
                <span className="font-medium">{client.name}</span>
                <span className="text-xs text-muted">
                  {t(`clientKinds.${client.kind}`)} ·{" "}
                  {t("clients.matterCount", { count: client.matterCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewMatterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [params] = useSearchParams();
  const preselected = params.get("client");

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [clientId, setClientId] = useState<string | null>(preselected);
  const [client, setClient] = useState<ClientFormValues>(emptyClient);
  const [conflictQuery, setConflictQuery] = useState<string | null>(null);
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [matter, setMatter] = useState<MatterValues>({
    title: "",
    area: "civil",
    openedOn: officeToday(),
    court: "",
    courtCaseNumber: "",
    description: "",
    restricted: false,
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [needClient, setNeedClient] = useState(false);
  const setField = <K extends keyof MatterValues>(key: K, value: MatterValues[K]) => {
    setMatter((m) => ({ ...m, [key]: value }));
  };

  const nameToCheck = client.name.trim();
  const conflictChecked = checkedName !== null && checkedName === nameToCheck;

  const open = useMutation({
    mutationFn: async (body: { matter: object; newClient: object | null }) => {
      let id = clientId;
      if (body.newClient) {
        const created = await send("POST", "/api/clients", body.newClient, clientResponseSchema);
        id = created.client.id;
      }
      try {
        return await send(
          "POST",
          "/api/matters",
          { ...body.matter, clientId: id },
          matterResponseSchema,
        );
      } catch (error) {
        if (body.newClient && id) throw new MatterNotOpened(id, error);
        throw error;
      }
    },
    onSuccess: async ({ matter: created }) => {
      await invalidate();
      await navigate(`/matters/${created.id}`, { state: { created: created.reference } });
    },
    onError: async (error) => {
      if (error instanceof MatterNotOpened) await invalidate();
      const apiError = error instanceof MatterNotOpened ? error.reason : error;
      if (apiError instanceof ApiError && apiError.code === "validation_failed") {
        setInvalid(new Set(apiError.fields));
      }
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const matterBody = {
      title: matter.title,
      area: matter.area,
      openedOn: matter.openedOn,
      court: matter.court,
      courtCaseNumber: matter.courtCaseNumber,
      description: matter.description,
      restricted: matter.restricted,
    };
    const nextInvalid = invalidFields(
      createMatterRequestSchema.omit({ clientId: true }).safeParse(matterBody).error,
    );
    if (matter.openedOn > officeToday()) nextInvalid.add("openedOn");

    let newClient: object | null = null;
    if (mode === "new") {
      newClient = clientBody(client);
      for (const path of invalidFields(createClientRequestSchema.safeParse(newClient).error)) {
        nextInvalid.add(`client.${path}`);
      }
    }
    setInvalid(nextInvalid);
    const missingClient = mode === "existing" ? clientId === null : !conflictChecked;
    setNeedClient(missingClient);
    if (nextInvalid.size === 0 && !missingClient) open.mutate({ matter: matterBody, newClient });
  };

  const clientInvalid = new Set(
    [...invalid].filter((p) => p.startsWith("client.")).map((p) => p.slice("client.".length)),
  );
  const error = (key: string) =>
    invalid.has(key) ? (key === "openedOn" ? t("form.futureDate") : t("form.invalid")) : undefined;
  const optional = (label: string) => t("common.optional", { label });
  const failure = open.error instanceof MatterNotOpened ? null : open.error;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl space-y-8">
      <PageHeader title={t("matters.new")} description={t("matters.newDescription")} />
      <form noValidate className="space-y-8" onSubmit={submit}>
        {open.error instanceof MatterNotOpened && (
          <Alert tone="danger">{t("matters.clientCreatedOnly")}</Alert>
        )}
        {failure && <Alert tone="danger">{errorMessage(failure)}</Alert>}

        <Section title={t("matters.clientStep")}>
          <Card className="space-y-5">
            <div
              role="radiogroup"
              aria-label={t("matters.clientStep")}
              className="flex flex-wrap gap-2"
            >
              {(["existing", "new"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className={cn(
                    "min-h-11 rounded-md border px-4 text-sm font-medium",
                    mode === value
                      ? "border-brand bg-brand text-brand-ink"
                      : "border-border bg-surface text-ink hover:bg-surface-muted",
                  )}
                  onClick={() => {
                    setMode(value);
                    setNeedClient(false);
                  }}
                >
                  {value === "existing" ? t("matters.existingClient") : t("matters.newClient")}
                </button>
              ))}
            </div>

            {mode === "existing" ? (
              <ExistingClientPicker selectedId={clientId} onSelect={setClientId} />
            ) : (
              <div className="space-y-5">
                <ClientFields values={client} onChange={setClient} invalid={clientInvalid} />
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <Button
                    variant="outline"
                    disabled={nameToCheck.length < 3}
                    onClick={() => {
                      setConflictQuery(nameToCheck);
                    }}
                  >
                    {t("conflicts.check")}
                  </Button>
                  <ConflictResults q={conflictQuery} onDone={setCheckedName} />
                  <p className="text-xs text-muted">{t("conflicts.audited")}</p>
                </div>
              </div>
            )}
            {/* Shown after a refused submit, until the missing step is done. */}
            {needClient && mode === "new" && !conflictChecked && (
              <Alert tone="danger">{t("matters.conflictRequired")}</Alert>
            )}
            {needClient && mode === "existing" && clientId === null && (
              <Alert tone="danger">{t("matters.chooseClient")}</Alert>
            )}
          </Card>
        </Section>

        <Section title={t("matters.matterStep")}>
          <Card className="space-y-4">
            <Field label={t("matters.matterTitle")} error={error("title")}>
              {(props) => (
                <Input
                  {...props}
                  maxLength={200}
                  value={matter.title}
                  onChange={(e) => {
                    setField("title", e.target.value);
                  }}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("matters.area")}>
                {(props) => (
                  <Select
                    {...props}
                    value={matter.area}
                    onChange={(e) => {
                      setField("area", e.target.value as MatterArea);
                    }}
                  >
                    {matterAreas.map((area) => (
                      <option key={area} value={area}>
                        {t(`areas.${area}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("matters.openedOn")} error={error("openedOn")}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    max={officeToday()}
                    value={matter.openedOn}
                    onChange={(e) => {
                      setField("openedOn", e.target.value);
                    }}
                  />
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={optional(t("matters.court"))} error={error("court")}>
                {(props) => (
                  <Input
                    {...props}
                    maxLength={200}
                    value={matter.court}
                    onChange={(e) => {
                      setField("court", e.target.value);
                    }}
                  />
                )}
              </Field>
              <Field
                label={optional(t("matters.courtCaseNumber"))}
                error={error("courtCaseNumber")}
              >
                {(props) => (
                  <Input
                    {...props}
                    dir="ltr"
                    maxLength={64}
                    value={matter.courtCaseNumber}
                    onChange={(e) => {
                      setField("courtCaseNumber", e.target.value);
                    }}
                  />
                )}
              </Field>
            </div>
            <Field label={optional(t("matters.descriptionField"))} error={error("description")}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  maxLength={4000}
                  value={matter.description}
                  onChange={(e) => {
                    setField("description", e.target.value);
                  }}
                />
              )}
            </Field>
            <Checkbox
              label={t("matters.restrictedLabel")}
              hint={t("matters.restrictedHint")}
              checked={matter.restricted}
              onChange={(e) => {
                setField("restricted", e.target.checked);
              }}
            />
          </Card>
        </Section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              void navigate(-1);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={open.isPending}>
            {t("matters.create")}
          </Button>
        </div>
      </form>
    </section>
  );
}
