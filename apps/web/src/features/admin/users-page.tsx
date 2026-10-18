import {
  adminUserListResponseSchema,
  createUserResponseSchema,
  passwordTokenResponseSchema,
  roles,
  type AdminUser,
  type Role,
} from "@lexora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Card, Dialog, PageHeader } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { getJson, send } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ReauthCancelled, useSensitiveAction } from "@/features/auth/reauth";
import { useSession } from "@/features/auth/session";
import { useErrorMessage } from "@/features/auth/use-error-message";

const usersQueryKey = ["admin", "users"] as const;

function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: ({ signal }) => getJson("/api/admin/users", adminUserListResponseSchema, { signal }),
  });
}

interface IssuedLink {
  name: string;
  token: string;
  expiresAt: string;
}

/** Shows a single-use password link once, to be handed over in person. */
function LinkDialog({ link, onClose }: { link: IssuedLink | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  const url = `${window.location.origin}/set-password#token=${link.token}`;
  const time = new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA", {
    timeStyle: "short",
  }).format(new Date(link.expiresAt));
  return (
    <Dialog open onClose={onClose} title={t("users.linkTitle")}>
      <div className="space-y-4">
        <p className="text-sm">{t("users.linkBody", { name: link.name, time })}</p>
        <code
          dir="ltr"
          data-testid="password-link"
          className="block break-all rounded-md bg-surface-muted px-3 py-2 font-mono text-xs"
        >
          {url}
        </code>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (link: IssuedLink) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const sensitive = useSensitiveAction();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("lawyer");

  const create = useMutation({
    mutationFn: () =>
      sensitive(() =>
        send("POST", "/api/admin/users", { email, displayName, role }, createUserResponseSchema),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
      setEmail("");
      setDisplayName("");
      onCreated({ name: result.user.displayName, ...result.setup });
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("users.createTitle")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {create.isError && !(create.error instanceof ReauthCancelled) && (
          <Alert tone="danger">{errorMessage(create.error)}</Alert>
        )}
        <Field label={t("users.name")}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("users.email")}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="off"
              dir="ltr"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("users.role")}>
          {(props) => (
            <Select
              {...props}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t("users.createSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type PendingAction = "disable" | "resetMfa" | "signOut" | null;

function UserActionsDialog({
  user,
  isSelf,
  onClose,
  onLink,
}: {
  user: AdminUser;
  isSelf: boolean;
  onClose: () => void;
  onLink: (link: IssuedLink) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const sensitive = useSensitiveAction();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(user.role);
  const [confirming, setConfirming] = useState<PendingAction>(null);
  const [done, setDone] = useState(false);

  const act = useMutation({
    mutationFn: (action: () => Promise<unknown>) => sensitive(action),
    onSuccess: async () => {
      setConfirming(null);
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
  });

  const path = `/api/admin/users/${user.id}` as const;
  const confirmText: Record<Exclude<PendingAction, null>, string> = {
    disable: t("users.confirmDisable", { name: user.displayName }),
    resetMfa: t("users.confirmResetMfa", { name: user.displayName }),
    signOut: t("users.confirmSignOut", { name: user.displayName }),
  };
  const confirmed: Record<Exclude<PendingAction, null>, () => Promise<unknown>> = {
    disable: () => send("PATCH", path, { disabled: true }),
    resetMfa: () => send("POST", `${path}/mfa-reset`),
    signOut: () => send("POST", `${path}/sessions/revoke`),
  };

  return (
    <Dialog open onClose={onClose} title={t("users.actions", { name: user.displayName })}>
      <div className="space-y-4">
        {done && <Alert tone="success">{t("users.done")}</Alert>}
        {act.isError && !(act.error instanceof ReauthCancelled) && (
          <Alert tone="danger">{errorMessage(act.error)}</Alert>
        )}

        {confirming ? (
          <div className="space-y-4">
            <p className="text-sm">{confirmText[confirming]}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirming(null);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={act.isPending}
                onClick={() => {
                  act.mutate(confirmed[confirming]);
                }}
              >
                {t("common.continue")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!isSelf && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label={t("users.changeRole")}>
                    {(props) => (
                      <Select
                        {...props}
                        value={role}
                        onChange={(e) => {
                          setRole(e.target.value as Role);
                        }}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {t(`roles.${r}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Button
                  disabled={role === user.role || act.isPending}
                  onClick={() => {
                    act.mutate(() => send("PATCH", path, { role }));
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
            <div className="grid gap-2">
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => {
                  act.mutate(async () => {
                    const issued = await send(
                      "POST",
                      `${path}/password-token`,
                      undefined,
                      passwordTokenResponseSchema,
                    );
                    onLink({ name: user.displayName, ...issued });
                  });
                }}
              >
                {t("users.passwordLink")}
              </Button>
              {!isSelf && user.mfaEnabled && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirming("resetMfa");
                  }}
                >
                  {t("users.resetMfa")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setConfirming("signOut");
                }}
              >
                {t("users.signOut")}
              </Button>
              {!isSelf &&
                (user.disabled ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      act.mutate(() => send("PATCH", path, { disabled: false }));
                    }}
                  >
                    {t("users.enable")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="text-danger"
                    onClick={() => {
                      setConfirming("disable");
                    }}
                  >
                    {t("users.disable")}
                  </Button>
                ))}
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function StatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  const [label, tone] = user.disabled
    ? [t("users.statusDisabled"), "bg-danger-soft text-danger"]
    : !user.hasPassword
      ? [t("users.statusPending"), "bg-surface-muted text-muted"]
      : [t("users.statusActive"), "bg-success-soft text-success"];
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const users = useUsers();
  const me = useSession().data?.user;
  const errorMessage = useErrorMessage();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [link, setLink] = useState<IssuedLink | null>(null);
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section aria-labelledby="page-title">
      <div className="mb-6 flex flex-col gap-4 sm:mb-0 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title={t("users.title")} description={t("users.description")} />
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          {t("users.add")}
        </Button>
      </div>

      {users.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {users.isError && <Alert tone="danger">{errorMessage(users.error)}</Alert>}
      {users.data?.users.length === 0 && <p className="text-sm text-muted">{t("users.empty")}</p>}

      {users.data && users.data.users.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {users.data.users.map((user) => (
              <li
                key={user.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {user.displayName}
                    {user.id === me?.id && (
                      <span className="ms-2 text-xs text-muted">({t("users.you")})</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted" dir="ltr">
                    {user.email}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-ink">{t(`roles.${user.role}`)}</span>
                    <StatusBadge user={user} />
                    <span>
                      {t("users.labelValue", {
                        label: t("users.twoFactor"),
                        value: user.mfaEnabled ? t("users.mfaOn") : t("users.mfaOff"),
                      })}
                    </span>
                    <span>
                      {t("users.labelValue", {
                        label: t("users.lastActive"),
                        value: user.lastActiveAt
                          ? dateFormat.format(new Date(user.lastActiveAt))
                          : t("users.never"),
                      })}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  aria-label={t("users.actions", { name: user.displayName })}
                  onClick={() => {
                    setSelected(user);
                  }}
                >
                  {t("users.manage")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CreateUserDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={(issued) => {
          setCreating(false);
          setLink(issued);
        }}
      />
      {selected && (
        <UserActionsDialog
          user={selected}
          isSelf={selected.id === me?.id}
          onClose={() => {
            setSelected(null);
          }}
          onLink={(issued) => {
            setSelected(null);
            setLink(issued);
          }}
        />
      )}
      <LinkDialog
        link={link}
        onClose={() => {
          setLink(null);
        }}
      />
    </section>
  );
}
