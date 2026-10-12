import { Fragment, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Form, Link, useNavigate } from "react-router";
import {
  DESIGN_SYSTEM_ENTRY_FIELDS,
  DESIGN_SYSTEM_ENTRY_KINDS,
  DESIGN_SYSTEM_STATUSES,
  entrySlotName,
  isDesignSystemEntry,
  isDesignSystemEntryKind,
} from "@domain-harness/contract";
import type { DesignSystemEntryField, DesignSystemEntryKind, StandardInfo } from "@domain-harness/contract";
import { Button } from "./button.tsx";
import { ProjectScopeField, STANDARDS_COPY } from "./standard-form.tsx";
import type { StandardFormProps } from "./standard-form.tsx";

export const DESIGN_SYSTEM_COPY = {
  publishHeading: "Publish a design-system Standard",
  chooseStatus: "Choose a status",
  labels: {
    kind: "Entry kind",
    name: "Name",
    usageRule: "Usage rule",
    tokens: "Tokens it depends on (optional, separated by commas)",
    correctionInstruction: "Correction instruction (optional)",
    specifier: "Module specifier",
    status: "Status",
  },
  fieldErrors: {
    kind: "Choose an entry kind: component, token or import.",
    name: "Enter a name of 1 to 200 characters.",
    usageRule: "Enter a usage rule of 1 to 1000 characters.",
    tokens:
      "List at most 50 different token names of 1 to 200 characters each, separated by commas, or leave it empty.",
    correctionInstruction: "Enter a Correction instruction of at most 1000 characters, or leave it empty.",
    specifier: "Enter a module specifier of 1 to 200 characters.",
    status: "Choose a status: required or prohibited.",
  },
} as const satisfies {
  readonly labels: Readonly<Record<DesignSystemEntryField, string>>;
  readonly fieldErrors: Readonly<Record<DesignSystemEntryField, string>>;
  readonly [key: string]: unknown;
};

/** Split the Tokens field: comma-separated, trimmed, blanks dropped. */
export function splitTokens(text: string): string[] {
  return text
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
}

const FIELD_IDS: Readonly<Record<DesignSystemEntryField, string>> = {
  kind: "design-system-kind",
  name: "design-system-name",
  usageRule: "design-system-usage-rule",
  tokens: "design-system-tokens",
  correctionInstruction: "design-system-correction-instruction",
  specifier: "design-system-specifier",
  status: "design-system-status",
};

/** The edited Standard's value for a field, as the form shows it. */
function editedValue(editing: StandardInfo | null, field: DesignSystemEntryField): string {
  const entry = editing?.entry;
  if (entry === undefined || !isDesignSystemEntry(entry)) return "";
  const value: unknown = (entry as unknown as Record<string, unknown>)[field];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

/**
 * standard-form for one design-system entry. After the Project scope, "Entry kind" comes first and
 * picks the one field set that renders: a component (Name, Usage rule,
 * Tokens, Correction instruction), a token (Name, Status) or an import
 * (Module specifier, Status); then the gold Publish button. Editing focuses
 * the first field; Esc leaves without committing and returns focus to the
 * row's Edit link. An invalid submit keeps every value and puts ink text
 * under the field.
 */
export function DesignSystemForm({ action, editing, submitted, projectTree }: StandardFormProps) {
  const navigate = useNavigate();
  const errors = submitted?.fieldErrors ?? {};
  const submittedKind = submitted?.values.kind;
  const editedKind = editing !== null && isDesignSystemEntry(editing.entry) ? editing.entry.kind : undefined;
  const [kind, setKind] = useState<DesignSystemEntryKind>(
    isDesignSystemEntryKind(submittedKind) ? submittedKind : (editedKind ?? "component"),
  );

  const value = (field: DesignSystemEntryField): string => submitted?.values[field] ?? editedValue(editing, field);
  const describedBy = (field: DesignSystemEntryField) =>
    errors[field] === undefined ? {} : { "aria-invalid": true as const, "aria-describedby": `${FIELD_IDS[field]}-error` };
  const errorText = (field: DesignSystemEntryField) =>
    errors[field] === undefined ? null : (
      <p id={`${FIELD_IDS[field]}-error`} className="field-error">
        {errors[field]}
      </p>
    );
  const label = (field: DesignSystemEntryField) => (
    <label htmlFor={FIELD_IDS[field]} className="type-label">
      {DESIGN_SYSTEM_COPY.labels[field]}
    </label>
  );
  const text = (field: "name" | "tokens" | "specifier") => (
    <>
      {label(field)}
      <input
        id={FIELD_IDS[field]}
        name={field}
        type="text"
        autoComplete="off"
        defaultValue={value(field)}
        {...describedBy(field)}
      />
      {errorText(field)}
    </>
  );
  const textarea = (field: "usageRule" | "correctionInstruction") => (
    <>
      {label(field)}
      <textarea id={FIELD_IDS[field]} name={field} rows={4} defaultValue={value(field)} {...describedBy(field)} />
      {errorText(field)}
    </>
  );
  const fields: Readonly<Record<DesignSystemEntryField, () => ReactNode>> = {
    kind: () => null,
    name: () => text("name"),
    usageRule: () => textarea("usageRule"),
    tokens: () => text("tokens"),
    correctionInstruction: () => textarea("correctionInstruction"),
    specifier: () => text("specifier"),
    status: () => (
      <>
        {label("status")}
        <select id={FIELD_IDS.status} name="status" defaultValue={value("status")} {...describedBy("status")}>
          <option value="">{DESIGN_SYSTEM_COPY.chooseStatus}</option>
          {DESIGN_SYSTEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        {errorText("status")}
      </>
    ),
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Escape" || editing === null) return;
    event.preventDefault();
    void navigate(action, { state: { focusEdit: editing.id }, preventScrollReset: true });
  };

  const heading =
    editing === null ? DESIGN_SYSTEM_COPY.publishHeading : STANDARDS_COPY.editHeading(entrySlotName(editing.entry));
  return (
    <Form
      method="post"
      action={action}
      className="standard-form"
      aria-labelledby="standard-form-heading"
      noValidate
      onKeyDown={onKeyDown}
    >
      <h2 id="standard-form-heading" className="type-title-sm">
        {heading}
      </h2>
      <input type="hidden" name="intent" value="publish" />
      {editing === null ? null : <input type="hidden" name="standardId" value={editing.id} />}

      <ProjectScopeField editing={editing} submitted={submitted} projectTree={projectTree} />

      {label("kind")}
      <select
        id={FIELD_IDS.kind}
        name="kind"
        value={kind}
        onChange={(event) => {
          if (isDesignSystemEntryKind(event.target.value)) setKind(event.target.value);
        }}
        autoFocus={editing !== null}
        {...describedBy("kind")}
      >
        {DESIGN_SYSTEM_ENTRY_KINDS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {errorText("kind")}

      <div className="standard-form__fields">
        {DESIGN_SYSTEM_ENTRY_FIELDS[kind]
          .filter((field) => field !== "kind")
          .map((field) => (
            <Fragment key={field}>{fields[field]()}</Fragment>
          ))}
      </div>

      <div className="standard-form__actions">
        <Button variant="primary" type="submit">
          {STANDARDS_COPY.publish}
        </Button>
        {editing === null ? null : (
          <Link to={action} state={{ focusEdit: editing.id }} preventScrollReset>
            {STANDARDS_COPY.cancelEdit}
          </Link>
        )}
      </div>
    </Form>
  );
}
