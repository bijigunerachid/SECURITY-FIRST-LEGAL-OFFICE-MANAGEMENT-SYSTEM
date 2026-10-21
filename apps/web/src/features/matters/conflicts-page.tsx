import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { ConflictResults } from "./conflict-results";

export function ConflictsPage() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [q, setQ] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState(false);

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("conflicts.title")} description={t("conflicts.description")} />
      <Card className="space-y-5">
        <form
          role="search"
          aria-label={t("conflicts.title")}
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            setTooShort(value.length < 3);
            if (value.length >= 3) setQ(value);
          }}
        >
          <div className="flex-1">
            <Field
              label={t("conflicts.query")}
              hint={t("conflicts.queryHint")}
              error={tooShort ? t("conflicts.queryHint") : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  type="search"
                  autoComplete="off"
                  maxLength={100}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <Button type="submit" className="sm:mt-7">
            {t("conflicts.submit")}
          </Button>
        </form>
        <ConflictResults q={q} />
        <p className="text-xs text-muted">{t("conflicts.audited")}</p>
      </Card>
    </section>
  );
}
