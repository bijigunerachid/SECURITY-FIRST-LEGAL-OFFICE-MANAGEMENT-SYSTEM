import { Check, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Section } from "@/components/ui/feedback";

type Cell = "yes" | "no" | "lead";

/**
 * What each role may do, for administrators choosing a role. It describes
 * the rules the server enforces (policy module); it does not change them.
 */
const ROWS: [key: string, admin: Cell, lawyer: Cell, assistant: Cell][] = [
  ["users", "yes", "no", "no"],
  ["breakGlass", "yes", "no", "no"],
  ["auditLog", "yes", "no", "no"],
  ["billingSettings", "yes", "no", "no"],
  ["openMatters", "no", "yes", "no"],
  ["conflicts", "no", "yes", "no"],
  ["workOnMatters", "no", "yes", "yes"],
  ["manageTeam", "no", "lead", "no"],
  ["matterHistory", "no", "lead", "no"],
  ["deleteDocuments", "no", "yes", "no"],
  ["draftInvoices", "no", "yes", "yes"],
  ["issueInvoices", "no", "yes", "no"],
];

function Mark({ cell }: { cell: Cell }) {
  const { t } = useTranslation();
  if (cell === "no") {
    return (
      <>
        <Minus className="inline size-4 text-muted" aria-hidden="true" />
        <span className="sr-only">{t("rolesTable.no")}</span>
      </>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Check className="size-4 text-success" aria-hidden="true" />
      <span className={cell === "lead" ? "text-xs" : "sr-only"}>
        {cell === "lead" ? t("rolesTable.leadOnly") : t("rolesTable.yes")}
      </span>
    </span>
  );
}

export function RolesTable() {
  const { t } = useTranslation();
  return (
    <Section title={t("rolesTable.title")}>
      <p className="text-sm text-muted">{t("rolesTable.description")}</p>
      <Card className="p-0 sm:p-0">
        {/* Scrolls sideways on phones: focusable and named so keyboards can scroll it too. */}
        <div
          role="region"
          aria-label={t("rolesTable.title")}
          tabIndex={0}
          className="relative overflow-x-auto rounded-xl"
        >
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t("rolesTable.action")}
                </th>
                {(["admin", "lawyer", "assistant"] as const).map((role) => (
                  <th key={role} scope="col" className="px-4 py-2 text-center font-medium">
                    {t(`roles.${role}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ROWS.map(([key, ...cells]) => (
                <tr key={key}>
                  <th scope="row" className="px-4 py-2 text-start font-normal">
                    {t(`rolesTable.rows.${key}`)}
                  </th>
                  {cells.map((cell, i) => (
                    <td key={i} className="px-4 py-2 text-center">
                      <Mark cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}
