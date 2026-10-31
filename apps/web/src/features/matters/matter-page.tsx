import {
  clientKinds,
  matterAreas,
  matterStatuses,
  partyRequestSchema,
  partyRoles,
  updateMatterRequestSchema,
  type ClientKind,
  type MatterArea,
  type MatterDetail,
  type MatterStatus,
  type Party,
  type PartyRole,
} from "@lexora/shared";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Dialog, Section } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useSession } from "@/features/auth/session";
import { BillingSection } from "@/features/billing/billing-section";
import { HearingsSection } from "@/features/calendar/hearings-section";
import { TasksSection } from "@/features/calendar/tasks-section";
import { DocumentsSection } from "@/features/documents/documents-section";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { isApiError, send } from "@/lib/api";
import {
  ConfirmDialog,
  Detail,
  MatterStatusBadge,
  NotFoundNotice,
  RestrictedBadge,
} from "./matter-ui";
import {
  invalidFields,
  officeToday,
  useFormat,
  useInvalidateMatters,
  useMatter,
  useTeamCandidates,
} from "./queries";

// --- Details -------------------------------------------------------------------

interface DetailsValues {
  title: string;
  area: MatterArea;
  status: MatterStatus;
  openedOn: string;
  court: string;
  courtCaseNumber: string;
  description: string;
  restricted: boolean;
}

function EditDetailsDialog({ matter, onClose }: { matter: MatterDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [values, setValues] = useState<DetailsValues>({
    title: matter.title,
    area: matter.area,
    status: matter.status,
    openedOn: matter.openedOn,
    court: matter.court ?? "",
    courtCaseNumber: matter.courtCaseNumber ?? "",
    description: matter.description ?? "",
    restricted: matter.restricted,
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof DetailsValues>(key: K, value: DetailsValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (body: object) => send("PATCH", `/api/matters/${matter.id}`, body),
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
    const body = {
      title: values.title,
      area: values.area,
      status: values.status,
      openedOn: values.openedOn,
      court: values.court,
      courtCaseNumber: values.courtCaseNumber,
      description: values.description,
      // Only sent when the user may change it, so a member's save is never refused for it.
      ...(matter.permissions.setRestricted ? { restricted: values.restricted } : {}),
    };
    const parsed = updateMatterRequestSchema.safeParse(body);
    const nextInvalid = invalidFields(parsed.error);
    if (values.openedOn > officeToday()) nextInvalid.add("openedOn");
    setInvalid(nextInvalid);
    if (nextInvalid.size === 0) save.mutate(body);
  };

  const error = (key: string) =>
    invalid.has(key) ? (key === "openedOn" ? t("form.futureDate") : t("form.invalid")) : undefined;
  const optional = (label: string) => t("common.optional", { label });

  return (
    <Dialog open onClose={onClose} title={t("matters.editDetails")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <Field label={t("matters.matterTitle")} error={error("title")}>
          {(props) => (
            <Input
              {...props}
              maxLength={200}
              value={values.title}
              onChange={(e) => {
                set("title", e.target.value);
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("matters.area")}>
            {(props) => (
              <Select
                {...props}
                value={values.area}
                onChange={(e) => {
                  set("area", e.target.value as MatterArea);
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
          <Field label={t("matters.status")}>
            {(props) => (
              <Select
                {...props}
                value={values.status}
                onChange={(e) => {
                  set("status", e.target.value as MatterStatus);
                }}
              >
                {matterStatuses.map((status) => (
                  <option key={status} value={status}>
                    {t(`matterStatuses.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t("matters.openedOn")} error={error("openedOn")}>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={officeToday()}
              value={values.openedOn}
              onChange={(e) => {
                set("openedOn", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("matters.court"))} error={error("court")}>
          {(props) => (
            <Input
              {...props}
              maxLength={200}
              value={values.court}
              onChange={(e) => {
                set("court", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("matters.courtCaseNumber"))} error={error("courtCaseNumber")}>
          {(props) => (
            <Input
              {...props}
              dir="ltr"
              maxLength={64}
              value={values.courtCaseNumber}
              onChange={(e) => {
                set("courtCaseNumber", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("matters.descriptionField"))} error={error("description")}>
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              maxLength={4000}
              value={values.description}
              onChange={(e) => {
                set("description", e.target.value);
              }}
            />
          )}
        </Field>
        <Checkbox
          label={t("matters.restrictedLabel")}
          hint={
            matter.permissions.setRestricted
              ? t("matters.restrictedHint")
              : t("matters.onlyLeadRestricts")
          }
          checked={values.restricted}
          disabled={!matter.permissions.setRestricted}
          onChange={(e) => {
            set("restricted", e.target.checked);
          }}
        />
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

function DetailsSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [editing, setEditing] = useState(false);
  return (
    <Section
      title={t("matters.details")}
      actions={
        matter.permissions.update && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
            {t("matters.editDetails")}
          </Button>
        )
      }
    >
      <Card>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label={t("matters.area")}>{t(`areas.${matter.area}`)}</Detail>
          <Detail label={t("matters.status")}>
            <MatterStatusBadge status={matter.status} />
          </Detail>
          <Detail label={t("matters.openedOn")}>{format.date(matter.openedOn)}</Detail>
          {matter.closedOn && (
            <Detail label={t("matters.closedOn")}>{format.date(matter.closedOn)}</Detail>
          )}
          <Detail label={t("matters.court")}>{matter.court ?? "—"}</Detail>
          <Detail label={t("matters.courtCaseNumber")}>
            <span dir="ltr">{matter.courtCaseNumber ?? "—"}</span>
          </Detail>
          <Detail label={t("matters.descriptionField")} className="sm:col-span-2">
            {matter.description ?? "—"}
          </Detail>
        </dl>
      </Card>
      {editing && (
        <EditDetailsDialog
          matter={matter}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </Section>
  );
}

// --- Team ----------------------------------------------------------------------

/** 409 answers from team changes, in words that say what to do next. */
function useTeamError() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return (error: unknown, kind: "add" | "remove" | "lead") => {
    if (isApiError(error, "conflict")) {
      return t(
        kind === "add"
          ? "team.alreadyMember"
          : kind === "remove"
            ? "team.leadFirst"
            : "team.onlyLawyerLead",
      );
    }
    return errorMessage(error);
  };
}

function AddMemberDialog({ matterId, onClose }: { matterId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const teamError = useTeamError();
  const invalidate = useInvalidateMatters();
  const candidates = useTeamCandidates(matterId, true);
  const [userId, setUserId] = useState("");
  const add = useMutation({
    mutationFn: (id: string) => send("POST", `/api/matters/${matterId}/members`, { userId: id }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  const users = candidates.data?.users ?? [];
  const chosen = userId !== "" ? userId : (users[0]?.id ?? "");

  return (
    <Dialog open onClose={onClose} title={t("team.addTitle")}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen) add.mutate(chosen);
        }}
      >
        {candidates.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {candidates.isError && <Alert tone="danger">{errorMessage(candidates.error)}</Alert>}
        {add.isError && <Alert tone="danger">{teamError(add.error, "add")}</Alert>}
        {candidates.data && users.length === 0 && (
          <p className="text-sm text-muted">{t("team.noCandidates")}</p>
        )}
        {users.length > 0 && (
          <Field label={t("team.person")}>
            {(props) => (
              <Select
                {...props}
                value={chosen}
                onChange={(e) => {
                  setUserId(e.target.value);
                }}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} · {t(`roles.${user.role}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={add.isPending || users.length === 0}>
            {t("common.add")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type TeamAction = { kind: "remove" | "lead"; userId: string; name: string } | null;

function TeamSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const teamError = useTeamError();
  const invalidate = useInvalidateMatters();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<TeamAction>(null);
  const { manageTeam, claimLead } = matter.permissions;

  const act = useMutation({
    mutationFn: (action: NonNullable<TeamAction>) =>
      action.kind === "remove"
        ? send("DELETE", `/api/matters/${matter.id}/members/${action.userId}`)
        : send("POST", `/api/matters/${matter.id}/lead`, { userId: action.userId }),
    onSuccess: async () => {
      setPending(null);
      await invalidate();
    },
  });
  const myId = useSession().data?.user.id;

  return (
    <Section
      title={t("team.title")}
      actions={
        manageTeam && (
          <Button
            variant="outline"
            onClick={() => {
              setAdding(true);
            }}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {t("team.add")}
          </Button>
        )
      }
    >
      {claimLead && (
        <Alert tone="info" title={t("team.claimLead")}>
          <p>{t("team.claimHint")}</p>
          <Button
            className="mt-3"
            disabled={act.isPending}
            onClick={() => {
              // A lawyer can only take the lead for themselves.
              if (myId) act.mutate({ kind: "lead", userId: myId, name: "" });
            }}
          >
            {t("team.claimLead")}
          </Button>
        </Alert>
      )}
      {act.isError && !pending && <Alert tone="danger">{teamError(act.error, "lead")}</Alert>}
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {matter.members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {member.displayName}
                  {member.memberRole === "lead" && (
                    <Badge tone="accent">{t("team.leadBadge")}</Badge>
                  )}
                  {!member.active && <Badge tone="danger">{t("team.inactive")}</Badge>}
                </p>
                <p className="text-sm text-muted">{t(`roles.${member.role}`)}</p>
              </div>
              {manageTeam && member.memberRole !== "lead" && (
                <div className="flex flex-wrap gap-2">
                  {member.role === "lawyer" && member.active && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPending({
                          kind: "lead",
                          userId: member.userId,
                          name: member.displayName,
                        });
                      }}
                    >
                      {t("team.makeLead", { name: member.displayName })}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="text-danger"
                    aria-label={t("team.remove", { name: member.displayName })}
                    onClick={() => {
                      setPending({
                        kind: "remove",
                        userId: member.userId,
                        name: member.displayName,
                      });
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t("common.remove")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {adding && (
        <AddMemberDialog
          matterId={matter.id}
          onClose={() => {
            setAdding(false);
          }}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "remove"
            ? t("team.remove", { name: pending.name })
            : t("team.makeLead", { name: pending?.name ?? "" })
        }
        message={
          pending?.kind === "remove"
            ? t("team.confirmRemove", { name: pending.name })
            : t("team.confirmLead", { name: pending?.name ?? "" })
        }
        error={act.isError && pending ? teamError(act.error, pending.kind) : null}
        pending={act.isPending}
        onConfirm={() => {
          if (pending) act.mutate(pending);
        }}
        onClose={() => {
          setPending(null);
          act.reset();
        }}
      />
    </Section>
  );
}

// --- Parties -------------------------------------------------------------------

interface PartyValues {
  kind: ClientKind;
  name: string;
  role: PartyRole;
  identifier: string;
  notes: string;
}

function PartyDialog({
  matterId,
  party,
  onClose,
}: {
  matterId: string;
  party: Party | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [values, setValues] = useState<PartyValues>({
    kind: party?.kind ?? "person",
    name: party?.name ?? "",
    role: party?.role ?? "opposing_party",
    identifier: party?.identifier ?? "",
    notes: party?.notes ?? "",
  });
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const set = <K extends keyof PartyValues>(key: K, value: PartyValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (body: object) =>
      party
        ? send("PATCH", `/api/matters/${matterId}/parties/${party.id}`, body)
        : send("POST", `/api/matters/${matterId}/parties`, body),
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
    const body = {
      kind: values.kind,
      name: values.name,
      role: values.role,
      identifier: values.identifier.trim() === "" ? null : values.identifier,
      notes: values.notes.trim() === "" ? null : values.notes,
    };
    const nextInvalid = invalidFields(partyRequestSchema.safeParse(body).error);
    setInvalid(nextInvalid);
    if (nextInvalid.size === 0) save.mutate(body);
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optional = (label: string) => t("common.optional", { label });

  return (
    <Dialog open onClose={onClose} title={party ? t("parties.editTitle") : t("parties.addTitle")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("parties.role")}>
            {(props) => (
              <Select
                {...props}
                value={values.role}
                onChange={(e) => {
                  set("role", e.target.value as PartyRole);
                }}
              >
                {partyRoles.map((role) => (
                  <option key={role} value={role}>
                    {t(`partyRoles.${role}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("parties.kind")}>
            {(props) => (
              <Select
                {...props}
                value={values.kind}
                onChange={(e) => {
                  set("kind", e.target.value as ClientKind);
                }}
              >
                {clientKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`clientKinds.${kind}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t("parties.name")} error={error("name")}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              maxLength={200}
              value={values.name}
              onChange={(e) => {
                set("name", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("parties.identifier"))} error={error("identifier")}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              dir="ltr"
              maxLength={64}
              value={values.identifier}
              onChange={(e) => {
                set("identifier", e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("parties.notes"))} error={error("notes")}>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              maxLength={1000}
              value={values.notes}
              onChange={(e) => {
                set("notes", e.target.value);
              }}
            />
          )}
        </Field>
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

function PartiesSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const invalidate = useInvalidateMatters();
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [removing, setRemoving] = useState<Party | null>(null);
  const canWrite = matter.permissions.writeParties;

  const remove = useMutation({
    mutationFn: (party: Party) => send("DELETE", `/api/matters/${matter.id}/parties/${party.id}`),
    onSuccess: async () => {
      setRemoving(null);
      await invalidate();
    },
  });

  return (
    <Section
      title={t("parties.title")}
      actions={
        canWrite && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("parties.add")}
          </Button>
        )
      }
    >
      {matter.parties.length === 0 ? (
        <p className="text-sm text-muted">{t("parties.empty")}</p>
      ) : (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {matter.parties.map((party) => (
              <li
                key={party.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium break-words">{party.name}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>{t(`partyRoles.${party.role}`)}</span>
                    <span>{t(`clientKinds.${party.kind}`)}</span>
                    {party.identifier && <span dir="ltr">{party.identifier}</span>}
                  </p>
                  {party.notes && (
                    <p className="text-sm break-words whitespace-pre-line">{party.notes}</p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      aria-label={t("parties.edit", { name: party.name })}
                      onClick={() => {
                        setEditing(party);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      {t("common.edit")}
                    </Button>
                    <Button
                      variant="outline"
                      className="text-danger"
                      aria-label={t("parties.remove", { name: party.name })}
                      onClick={() => {
                        setRemoving(party);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("common.remove")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <PartyDialog
          matterId={matter.id}
          party={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t("parties.remove", { name: removing?.name ?? "" })}
        message={t("parties.confirmRemove", { name: removing?.name ?? "" })}
        error={remove.isError ? errorMessage(remove.error) : null}
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
      />
    </Section>
  );
}

// --- Page ------------------------------------------------------------------------

export function MatterPage() {
  const { t } = useTranslation();
  const { matterId = "" } = useParams();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const query = useMatter(matterId);

  if (query.isPending) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  if (query.isError) {
    if (isApiError(query.error, "not_found")) {
      return (
        <NotFoundNotice
          title={t("matters.notFoundTitle")}
          body={t("matters.notFoundBody")}
          backTo="/matters"
          backLabel={t("matters.backToList")}
        />
      );
    }
    return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  }

  const { matter } = query.data;
  return (
    <article aria-labelledby="page-title" className="space-y-8">
      <header className="space-y-3">
        <Link
          to="/matters"
          className="inline-flex min-h-11 items-center text-sm text-ink underline decoration-accent decoration-2 underline-offset-4"
        >
          {t("matters.backToList")}
        </Link>
        <p dir="ltr" className="font-mono text-sm text-muted">
          {matter.reference}
        </p>
        <h1
          id="page-title"
          className="text-2xl font-semibold tracking-tight break-words sm:text-3xl"
        >
          {matter.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <MatterStatusBadge status={matter.status} />
          {matter.restricted && <RestrictedBadge />}
          <Badge>{t(`areas.${matter.area}`)}</Badge>
        </div>
        {matter.myRole && (
          <p className="text-sm text-muted">
            {matter.myRole === "lead" ? t("matters.myRoleLead") : t("matters.myRoleMember")}
          </p>
        )}
      </header>

      {matter.breakGlassUntil && (
        <div
          className="flex gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
          role="status"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{t("matters.breakGlassBanner", { time: format.time(matter.breakGlassUntil) })}</p>
        </div>
      )}

      <Section title={t("matters.client")}>
        <Card>
          <Link
            to={`/clients/${matter.client.id}`}
            className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4"
          >
            {matter.client.name}
          </Link>
          <p className="mt-1 text-sm text-muted">
            {t(`clientKinds.${matter.client.kind}`)}
            {matter.client.identifier && (
              <>
                {" · "}
                <span dir="ltr">{matter.client.identifier}</span>
              </>
            )}
          </p>
        </Card>
      </Section>

      <DetailsSection matter={matter} />
      <TeamSection matter={matter} />
      <PartiesSection matter={matter} />
      <HearingsSection matter={matter} />
      <TasksSection matter={matter} />
      <DocumentsSection matter={matter} />
      <BillingSection matter={matter} />
    </article>
  );
}
