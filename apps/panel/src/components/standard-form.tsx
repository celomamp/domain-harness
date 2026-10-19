import { Form, Link } from "react-router";
import {
  CODE_STACK_CATEGORIES,
  CODE_STACK_STATUSES,
  entrySlotKind,
  entrySlotName,
  isCodeStackEntry,
  MODULE_KIND_LABELS,
} from "@domain-harness/contract";
import type {
  CodeStackEntryField,
  DesignSystemEntryField,
  ProjectInfo,
  ProjectTree,
  StandardInfo,
} from "@domain-harness/contract";
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
  lockedRuleConflict:
    "Nothing was published. This version would contradict a Locked rule in the same Conflict slot.",
  loading: "Loading Standards…",
  sessionEnded: "Your session has ended, so the Standards cannot be shown.",
  signInAgain: "Sign in again",
  publishHeading: "Publish a code-stack Standard",
  editHeading: (name: string) => `Edit ${name}`,
  editLink: (name: string) => `Edit ${name}`,
  cancelEdit: "Cancel edit",
  publish: "Publish",
  publishedHeading: "Published",
  projectScope: "Project scope",
  projectScopeFixed: (name: string) => `Project scope: ${name} (fixed for this Standard)`,
  projectScopeError: "Choose a Project in this Company's Project tree.",
  projectTreeUnavailable:
    "The Project tree is unavailable right now, so this Standard will be published at the root Project.",
  /** A picker option: the root by name, any other Project with its level name. */
  projectOption: (project: ProjectInfo) =>
    project.parentId === null || project.levelName === null
      ? project.name
      : `${project.name} (level ${project.levelName})`,
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
    `Published ${entrySlotName(info.entry)}: Standard ${info.id}, version ${String(info.version)}, in Module ${info.module.name}, ` +
    `Project scope ${info.project.name}, at ${info.publishedAt}.`,
  /**
   * A slot conflict naming both Standards. `proposed` is the submitted slot
   * kind (category or entry kind) and slot name (name or module specifier).
   */
  conflict: (proposed: { slotKind: string; slotName: string; standardId: string }, holder: StandardInfo | null, holderId: string) => {
    const mine = `The ${proposed.slotKind} "${proposed.slotName.trim()}"${proposed.standardId === "" ? "" : ` (Standard ${proposed.standardId})`}`;
    if (holder === null) {
      return `Nothing was published. ${mine} is in the same Conflict slot as Standard ${holderId} at the same Project scope.`;
    }
    const kind = entrySlotKind(holder.entry);
    const name = entrySlotName(holder.entry);
    const slot = `(${MODULE_KIND_LABELS[holder.module.kind]}, ${kind}, "${name}")`;
    return (
      `Nothing was published. ${mine} is in the same Conflict slot ${slot} as Standard ${holder.id}, ` +
      `${kind} "${name}" in Module ${holder.module.name}, at Project ${holder.project.name}.`
    );
  },
} as const;

/** A field of either Standards form; `projectId` is the Project scope picker of a new Standard. */
export type StandardFormField = CodeStackEntryField | DesignSystemEntryField | "projectId";

/**
 * The fields of the code-stack or design-system form, as submitted (strings;
 * a component's tokens as typed, separated by commas), plus the Standard
 * being edited ("" for a new one). `projectId` is absent when no picker was
 * shown (editing, or the Project tree was unavailable).
 */
export type StandardFormValues = Readonly<Partial<Record<StandardFormField | "standardId", string>>>;

/** What the Module Standards action reports back to the page. */
export interface StandardFormActionData {
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: Readonly<Partial<Record<StandardFormField, string>>>;
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
  /** The Company's Project tree for the Project scope picker, or null when it is unavailable. */
  readonly projectTree: ProjectTree | null;
}

const PROJECT_FIELD_ID = "standard-project";

/** The side-sheet heading of the code-stack Standard form. */
export function standardFormHeading(editing: StandardInfo | null): string {
  return editing === null ? STANDARDS_COPY.publishHeading : STANDARDS_COPY.editHeading(entrySlotName(editing.entry));
}

/**
 * The Project scope of the Standard. A new Standard gets a picker of every
 * Project in tree order, the root selected by default (or the scope of a
 * refused submit); an edited Standard shows its fixed scope as text. When the
 * Project tree is unavailable, a note says the Standard goes to the root
 * Project, and no `projectId` is sent.
 */
export function ProjectScopeField({
  editing,
  submitted,
  projectTree,
}: Pick<StandardFormProps, "editing" | "submitted" | "projectTree">) {
  if (editing !== null) return <p>{STANDARDS_COPY.projectScopeFixed(editing.project.name)}</p>;
  if (projectTree === null) return <p>{STANDARDS_COPY.projectTreeUnavailable}</p>;
  const error = submitted?.fieldErrors.projectId;
  const kept = submitted?.values.projectId;
  const selected =
    kept !== undefined && projectTree.projects.some((project) => project.id === kept) ? kept : projectTree.rootId;
  return (
    <>
      <label htmlFor={PROJECT_FIELD_ID} className="type-label">
        {STANDARDS_COPY.projectScope}
      </label>
      <select
        id={PROJECT_FIELD_ID}
        name="projectId"
        defaultValue={selected}
        {...(error === undefined ? {} : { "aria-invalid": true as const, "aria-describedby": `${PROJECT_FIELD_ID}-error` })}
      >
        {projectTree.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {STANDARDS_COPY.projectOption(project)}
          </option>
        ))}
      </select>
      {error === undefined ? null : (
        <p id={`${PROJECT_FIELD_ID}-error`} className="field-error">
          {error}
        </p>
      )}
    </>
  );
}

const FIELD_IDS: Readonly<Record<CodeStackEntryField, string>> = {
  category: "standard-category",
  name: "standard-name",
  versionConstraint: "standard-version-constraint",
  status: "standard-status",
  correctionInstruction: "standard-correction-instruction",
};

/**
 * standard-form for one code-stack entry: the Project scope, then Category, Name, Version constraint,
 * Status and Correction instruction, then the gold Publish button. Editing
 * focuses the first field; Esc leaves without committing and returns focus to
 * the row's Edit link. An invalid submit keeps every value and puts ink text
 * under the field.
 */
export function StandardForm({ action, editing, submitted, projectTree }: StandardFormProps) {
  const errors = submitted?.fieldErrors ?? {};
  const value = (field: CodeStackEntryField): string => {
    const kept = submitted?.values[field];
    if (kept !== undefined) return kept;
    const entry = editing?.entry;
    return entry !== undefined && isCodeStackEntry(entry) ? (entry[field] ?? "") : "";
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

  return (
    <Form method="post" action={action} className="standard-form" noValidate>
      <input type="hidden" name="intent" value="publish" />
      {editing === null ? null : <input type="hidden" name="standardId" value={editing.id} />}

      <ProjectScopeField editing={editing} submitted={submitted} projectTree={projectTree} />

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
