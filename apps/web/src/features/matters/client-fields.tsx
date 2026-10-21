import { clientKinds, type ClientKind } from "@lexora/shared";
import { useTranslation } from "react-i18next";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export interface ClientFormValues {
  kind: ClientKind;
  name: string;
  identifier: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export const emptyClient: ClientFormValues = {
  kind: "person",
  name: "",
  identifier: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
};

/** The request body for these values: empty optional fields become null (no value). */
export function clientBody(values: ClientFormValues) {
  const optional = (value: string) => (value.trim() === "" ? null : value);
  return {
    kind: values.kind,
    name: values.name,
    identifier: optional(values.identifier),
    email: optional(values.email),
    phone: optional(values.phone),
    address: optional(values.address),
    notes: optional(values.notes),
  };
}

/** Client identity and contact fields, shared by "new client" and "edit client". */
export function ClientFields({
  values,
  onChange,
  invalid,
  withKind = true,
}: {
  values: ClientFormValues;
  onChange: (values: ClientFormValues) => void;
  invalid: Set<string>;
  withKind?: boolean;
}) {
  const { t } = useTranslation();
  const set = (key: keyof ClientFormValues) => (value: string) => {
    onChange({ ...values, [key]: value });
  };
  const error = (key: string) => (invalid.has(key) ? t("form.invalid") : undefined);
  const optional = (label: string) => t("common.optional", { label });

  return (
    <div className="space-y-4">
      {withKind && (
        <Field label={t("clients.kind")}>
          {(props) => (
            <Select
              {...props}
              value={values.kind}
              onChange={(e) => {
                set("kind")(e.target.value);
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
      )}
      <Field label={t("clients.name")} error={error("name")}>
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            maxLength={200}
            value={values.name}
            onChange={(e) => {
              set("name")(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label={optional(t("clients.identifier"))} error={error("identifier")}>
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            dir="ltr"
            maxLength={64}
            value={values.identifier}
            onChange={(e) => {
              set("identifier")(e.target.value);
            }}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={optional(t("clients.email"))} error={error("email")}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="off"
              dir="ltr"
              maxLength={254}
              value={values.email}
              onChange={(e) => {
                set("email")(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={optional(t("clients.phone"))} error={error("phone")}>
          {(props) => (
            <Input
              {...props}
              type="tel"
              autoComplete="off"
              dir="ltr"
              maxLength={32}
              value={values.phone}
              onChange={(e) => {
                set("phone")(e.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Field label={optional(t("clients.address"))} error={error("address")}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={500}
            value={values.address}
            onChange={(e) => {
              set("address")(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label={optional(t("clients.notes"))} error={error("notes")}>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            maxLength={4000}
            value={values.notes}
            onChange={(e) => {
              set("notes")(e.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}
