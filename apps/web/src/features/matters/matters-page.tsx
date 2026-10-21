import { matterStatuses, type MatterStatus } from "@lexora/shared";
import { FolderPlus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useSession } from "@/features/auth/session";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { MatterListItem, Pagination } from "./matter-ui";
import { useMatterList } from "./queries";

const isStatus = (value: string | null): value is MatterStatus =>
  (matterStatuses as readonly string[]).includes(value ?? "");

/** Search, filter and page state live in the address, so Back and reload keep them. */
function useListParams() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status");
  const page = Number(params.get("page") ?? "1");
  return {
    q: params.get("q") ?? "",
    status: isStatus(status) ? status : ("" as const),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    update(next: { q?: string; status?: MatterStatus | ""; page?: number }) {
      const merged = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        // Empty values and page 1 are the defaults: keep the address short.
        if (value === "" || (key === "page" && value === 1)) merged.delete(key);
        else merged.set(key, String(value));
      }
      setParams(merged);
    },
  };
}

export function MattersPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const role = useSession().data?.user.role;
  const list = useListParams();
  const matters = useMatterList({ q: list.q, status: list.status, page: list.page });
  const [text, setText] = useState(list.q);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    list.update({ q: text.trim(), page: 1 });
  };
  const filtered = list.q !== "" || list.status !== "";

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title={t("matters.title")}
          description={role === "admin" ? t("matters.descriptionAdmin") : t("matters.description")}
        />
        {role === "lawyer" && (
          <Link
            to="/matters/new"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            {t("matters.new")}
          </Link>
        )}
      </div>

      <form
        role="search"
        className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        onSubmit={submit}
      >
        <Field label={t("matters.searchLabel")} hint={t("matters.searchHint")}>
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
        <Field label={t("matters.statusFilter")}>
          {(props) => (
            <Select
              {...props}
              value={list.status}
              onChange={(e) => {
                const value = e.target.value;
                list.update({ status: isStatus(value) ? value : "", page: 1 });
              }}
            >
              <option value="">{t("matters.allStatuses")}</option>
              {matterStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`matterStatuses.${status}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="outline" className="sm:mb-5">
          {t("common.search")}
        </Button>
      </form>

      {matters.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {matters.isError && <Alert tone="danger">{errorMessage(matters.error)}</Alert>}
      {matters.data?.matters.length === 0 && (
        <p className="text-sm text-muted">
          {filtered ? t("matters.emptySearch") : t("matters.empty")}
        </p>
      )}
      {matters.data && matters.data.matters.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {matters.data.matters.map((matter) => (
              <MatterListItem key={matter.id} matter={matter} />
            ))}
          </ul>
        </Card>
      )}
      {matters.data && (
        <Pagination
          page={matters.data.page}
          hasMore={matters.data.hasMore}
          onPage={(page) => {
            list.update({ page });
          }}
        />
      )}
    </section>
  );
}
