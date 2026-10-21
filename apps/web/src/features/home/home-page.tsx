import {
  Activity,
  FolderOpen,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageHeader } from "@/components/ui/feedback";
import { useSession } from "@/features/auth/session";

function Tile({
  to,
  icon: Icon,
  title,
  text,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <Link
      to={to}
      className="flex gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors hover:bg-surface-muted"
    >
      <Icon className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden="true" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-1 block text-sm text-muted">{text}</span>
      </span>
    </Link>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const user = useSession().data?.user;
  if (!user) return null;
  return (
    <section aria-labelledby="page-title">
      <PageHeader
        title={t("home.welcome", { name: user.displayName })}
        description={t("home.description", { role: t(`roles.${user.role}`) })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {user.role !== "admin" && (
          <>
            <Tile
              to="/matters"
              icon={FolderOpen}
              title={t("nav.matters")}
              text={t("home.mattersCard")}
            />
            <Tile
              to="/clients"
              icon={UserRound}
              title={t("nav.clients")}
              text={t("home.clientsCard")}
            />
          </>
        )}
        {user.role === "lawyer" && (
          <Tile
            to="/conflicts"
            icon={Scale}
            title={t("nav.conflicts")}
            text={t("home.conflictsCard")}
          />
        )}
        <Tile
          to="/security"
          icon={ShieldCheck}
          title={t("nav.security")}
          text={t("home.securityCard")}
        />
        {user.role === "admin" && (
          <>
            <Tile
              to="/admin/users"
              icon={Users}
              title={t("nav.users")}
              text={t("home.usersCard")}
            />
            <Tile
              to="/admin/break-glass"
              icon={ShieldAlert}
              title={t("nav.breakGlass")}
              text={t("home.breakGlassCard")}
            />
          </>
        )}
        <Tile to="/status" icon={Activity} title={t("nav.status")} text={t("home.statusCard")} />
      </div>
    </section>
  );
}
