import type { ReactNode } from "react";
import { Form } from "react-router";
import type { ProjectInfo } from "@domain-harness/contract";
import { Button } from "./button.tsx";
import { PROJECT_TREE_COPY } from "./project-tree.tsx";

/** The fields of the New-application flow form. */
export type NewApplicationField = "description" | "projectId";

export const NEW_APPLICATION_COPY = {
  heading: "New-application flow",
  loading: "Loading the Projects…",
  unavailable: "The Projects are unavailable right now. Try again in a few minutes.",
  actionUnavailable: "The New-application flow is unavailable right now, so nothing was created. Try again in a few minutes.",
  labels: { description: "Description", projectId: "Project" } satisfies Record<NewApplicationField, string>,
  chooseProject: "Choose a Project",
  place: "Place the Application",
  fieldErrors: {
    description: "Describe the Application in 1 to 500 characters. Nothing was created.",
    projectId: "A description with no Project is not created. Choose a Project.",
  } satisfies Record<NewApplicationField, string>,
  placed: (projectName: string) => `The Application is placed on ${projectName}. The Buyer sees it on Inventory now.`,
  buildGrantDenied: (projectName: string) =>
    `You have no build grant on ${projectName}. Ask the Buyer for one. Nothing was created.`,
  projectNotFound: "That Project no longer exists. Choose another Project. Nothing was created.",
} as const;

/** What the New-application flow action reports back to the page. */
export interface NewApplicationActionData {
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: Readonly<Partial<Record<NewApplicationField, string>>>;
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: Readonly<Partial<Record<NewApplicationField, string>>>;
  /** The id of the Application just placed; the form is emptied after a success. */
  readonly placedId?: string;
}

const fieldId = (field: NewApplicationField) => `new-application-${field}`;

export interface NewApplicationFormProps {
  /** A refused submit: its values and field errors, kept in the fields. */
  readonly submitted: NewApplicationActionData | undefined;
  /** The Project field: {@link ProjectField} once the Projects load, or its busy or unavailable form. */
  readonly children: ReactNode;
}

const described = (errors: NewApplicationActionData["fieldErrors"], field: NewApplicationField) =>
  errors[field] === undefined ? {} : { "aria-invalid": true as const, "aria-describedby": `${fieldId(field)}-error` };

function FieldError({ errors, field }: { errors: NewApplicationActionData["fieldErrors"]; field: NewApplicationField }) {
  return errors[field] === undefined ? null : (
    <p id={`${fieldId(field)}-error`} className="field-error">
      {errors[field]}
    </p>
  );
}

/**
 * standard-form for the New-application flow: a Description textarea, the
 * Project field, then the one gold button. Shown to every role: the registry
 * refuses an account without a build grant on the chosen Project. The
 * Description stays mounted while the Projects load, so nothing typed is lost.
 */
export function NewApplicationForm({ submitted, children }: NewApplicationFormProps) {
  const errors = submitted?.fieldErrors ?? {};
  return (
    <Form method="post" className="standard-form" aria-label={NEW_APPLICATION_COPY.heading} noValidate>
      <label htmlFor={fieldId("description")} className="type-label">
        {NEW_APPLICATION_COPY.labels.description}
      </label>
      <textarea
        id={fieldId("description")}
        name="description"
        rows={4}
        defaultValue={submitted?.values.description ?? ""}
        {...described(errors, "description")}
      />
      <FieldError errors={errors} field="description" />
      {children}
      <Button variant="primary" type="submit">
        {NEW_APPLICATION_COPY.place}
      </Button>
    </Form>
  );
}

export interface ProjectFieldProps {
  /** Every Project in tree order; empty while the tree loads or when it is unavailable. */
  readonly projects: readonly ProjectInfo[];
  /** True while the Projects load. */
  readonly busy?: boolean;
  /** Shown under the select while the Projects load or when they are unavailable. */
  readonly note?: string | undefined;
  /** A refused submit: its chosen Project and field error, kept. */
  readonly submitted: NewApplicationActionData | undefined;
}

/** The "Project" select: the "Choose a Project" placeholder (value ""), then every Project in tree order, labelled as on the Project tree. */
export function ProjectField({ projects, busy = false, note, submitted }: ProjectFieldProps) {
  const errors = submitted?.fieldErrors ?? {};
  return (
    <div className="standard-form__fields" {...(busy ? { "aria-busy": true as const } : {})}>
      <label htmlFor={fieldId("projectId")} className="type-label">
        {NEW_APPLICATION_COPY.labels.projectId}
      </label>
      <select
        id={fieldId("projectId")}
        name="projectId"
        defaultValue={submitted?.values.projectId ?? ""}
        {...described(errors, "projectId")}
      >
        <option value="">{NEW_APPLICATION_COPY.chooseProject}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {PROJECT_TREE_COPY.option(project)}
          </option>
        ))}
      </select>
      <FieldError errors={errors} field="projectId" />
      {note === undefined ? null : <p>{note}</p>}
    </div>
  );
}
