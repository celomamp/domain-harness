import { Form, Link, useNavigate } from "react-router";
import type { KeyboardEvent } from "react";
import { CODE_STACK_CATEGORIES, CODE_STACK_STATUSES, MODULE_KIND_LABELS } from "@domain-harness/contract";
import type { CodeStackEntryField, StandardInfo } from "@domain-harness/contract";
import { Button } from "./button.tsx";

export const STANDARDS_COPY = {
  allModules: "All Modules",
  standardsHeading: "Standards",
  empty: "No Standard is published in this Module yet.",
  noOwner: "No owner",
  none: "None",
  unavailable: "Standards are unavailable right now. Try again in a few minutes.",
  actionUnavailable: "Standards are unavailable right now, so nothing was published. Try again in a few minutes.",
  moduleNotFound: "That Module was not found. Nothing was published.",
  modulePageNotFound: "That Module was not found.",
  standardNotFound: "That Standard was not found. Nothing was published.",
  noOwnerDenial:
    "This Module has no owner, so nothing can be published into it. The Buyer assigns its Standard owner. Nothing was published.",
  notOwnerDenial: "Only the Standard owner of this Module can publish into it. Nothing was published.",
  designSystemDenial: "Design-system entries are not available yet. Nothing was published.",
  designSystemNotice: "Design-system entries are not available yet.",
  publishHeading: "Publish a code-stack Standard",
  editHeading: (name: string) => `Edit ${name}`,
  editLink: (name: string) => `Edit ${name}`,
  cancelEdit: "Cancel edit",
  publish: "Publish",
  publishedHeading: "Published",
  chooseCategory: "Choose a category",
  chooseStatus: "Choose a status",
  labels: {
    category: "Category",
    name: "Name",
    versionConstraint: "Version constraint (optional)",
    status: "Status",
    correctionInstruction: "Correction instruction (optional)",
  },
  fieldErrors: {
    category: "Choose a category: language, framework or library.",
    name: "Enter a name of 1 to 200 characters.",
    versionConstraint: "Enter a version constraint of at most 100 characters, or leave it empty.",
    status: "Choose a status: approved, prohibited or required.",
    correctionInstruction: "Enter a Correction instruction of at most 1000 characters, or leave it empty.",
  },
  published: (info: StandardInfo) =>
    `Published ${info.entry.name}: Standard ${info.id}, version ${String(info.version)}, in Module ${info.module.name}, ` +
    `Project scope ${info.project.name} (root Project), at ${info.publishedAt}.`,
  conflict: (proposed: { category: string; name: string; standardId: string }, holder: StandardInfo | null, holderId: string) => {
    const mine = `The ${proposed.category} "${proposed.name.trim()}"${proposed.standardId === "" ? "" : ` (Standard ${proposed.standardId})`}`;
    if (holder === null) {
      return `Nothing was published. ${mine} is in the same Conflict slot as Standard ${holderId} at the root Project.`;
    }
    const slot = `(${MODULE_KIND_LABELS[holder.module.kind]}, ${holder.entry.category}, "${holder.entry.name}")`;
    return (
      `Nothing was published. ${mine} is in the same Conflict slot ${slot} as Standard ${holder.id}, ` +
      `${holder.entry.category} "${holder.entry.name}" in Module ${holder.module.name}, at the root Project.`
    );
  },
} as const;

/** The fields of the code-stack form, as submitted (strings), plus the Standard being edited ("" for a new one). */
export type StandardFormValues = Readonly<Partial<Record<CodeStackEntryField | "standardId", string>>>;

/** What the Module Standards action reports back to the page. */
export interface StandardFormActionData {
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: Readonly<Partial<Record<CodeStackEntryField, string>>>;
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: StandardFormValues;
  /** The version just published. */
  readonly published?: StandardInfo;
}

export interface StandardFormProps {
  /** The page the form posts to (the Module's Standards page, without `?edit`). */
  readonly action: string;
  /** The live version of the Standard being edited, or null for a new Standard. */
  readonly editing: StandardInfo | null;
  /** A refused submit's values and field errors, kept in the fields. */
  readonly submitted: StandardFormActionData | undefined;
}

const FIELD_IDS: Readonly<Record<CodeStackEntryField, string>> = {
  category: "standard-category",
  name: "standard-name",
  versionConstraint: "standard-version-constraint",
  status: "standard-status",
  correctionInstruction: "standard-correction-instruction",
};

/**
 * standard-form for one code-stack entry: Category, Name, Version constraint,
 * Status and Correction instruction, then the gold Publish button. Editing
 * focuses the first field; Esc leaves without committing and returns focus to
 * the row's Edit link. An invalid submit keeps every value and puts ink text
 * under the field.
 */
export function StandardForm({ action, editing, submitted }: StandardFormProps) {
  const navigate = useNavigate();
  const errors = submitted?.fieldErrors ?? {};
  const value = (field: CodeStackEntryField): string => {
    const kept = submitted?.values[field];
    if (kept !== undefined) return kept;
    const current = editing?.entry[field];
    return current ?? "";
  };
  const describedBy = (field: CodeStackEntryField) =>
    errors[field] === undefined ? {} : { "aria-invalid": true as const, "aria-describedby": `${FIELD_IDS[field]}-error` };
  const errorText = (field: CodeStackEntryField) =>
    errors[field] === undefined ? null : (
      <p id={`${FIELD_IDS[field]}-error`} className="field-error">
        {errors[field]}
      </p>
    );
  const label = (field: CodeStackEntryField) => (
    <label htmlFor={FIELD_IDS[field]} className="type-label">
      {STANDARDS_COPY.labels[field]}
    </label>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Escape" || editing === null) return;
    event.preventDefault();
    void navigate(action, { state: { focusEdit: editing.id }, preventScrollReset: true });
  };

  const heading = editing === null ? STANDARDS_COPY.publishHeading : STANDARDS_COPY.editHeading(editing.entry.name);
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

      {label("category")}
      <select
        id={FIELD_IDS.category}
        name="category"
        defaultValue={value("category")}
        autoFocus={editing !== null}
        {...describedBy("category")}
      >
        <option value="">{STANDARDS_COPY.chooseCategory}</option>
        {CODE_STACK_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
      {errorText("category")}

      {label("name")}
      <input
        id={FIELD_IDS.name}
        name="name"
        type="text"
        autoComplete="off"
        defaultValue={value("name")}
        {...describedBy("name")}
      />
      {errorText("name")}

      {label("versionConstraint")}
      <input
        id={FIELD_IDS.versionConstraint}
        name="versionConstraint"
        type="text"
        autoComplete="off"
        defaultValue={value("versionConstraint")}
        {...describedBy("versionConstraint")}
      />
      {errorText("versionConstraint")}

      {label("status")}
      <select id={FIELD_IDS.status} name="status" defaultValue={value("status")} {...describedBy("status")}>
        <option value="">{STANDARDS_COPY.chooseStatus}</option>
        {CODE_STACK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {errorText("status")}

      {label("correctionInstruction")}
      <textarea
        id={FIELD_IDS.correctionInstruction}
        name="correctionInstruction"
        rows={4}
        defaultValue={value("correctionInstruction")}
        {...describedBy("correctionInstruction")}
      />
      {errorText("correctionInstruction")}

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
