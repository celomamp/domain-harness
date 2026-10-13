import type { ReactNode } from "react";
import { Form } from "react-router";
import { GUIDANCE_ENDPOINT_URL_MAX } from "@domain-harness/contract";
import type {
  BoilerplateArtifactKind,
  BoilerplateResult,
  BoilerplateTarget,
  GuidanceEndpointState,
  ProjectInfo,
} from "@domain-harness/contract";
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
  endpoint: {
    heading: "Company Guidance endpoint",
    label: "Guidance endpoint URL",
    current: (url: string) => `Current endpoint: ${url}`,
    notSet: "Not set.",
    loading: "Loading the Guidance endpoint…",
    unavailable: "The Guidance endpoint is unavailable right now. Try again in a few minutes.",
    submit: "Set the Guidance endpoint",
    set: (url: string) => `The Company Guidance endpoint is set to ${url}.`,
    roleDenied: "Only the Buyer can set the Company Guidance endpoint. Nothing was changed.",
    fieldError: `Enter an https URL of up to ${String(GUIDANCE_ENDPOINT_URL_MAX)} characters with no user name, password or fragment. Nothing was changed.`,
    actionUnavailable: "The Guidance endpoint could not be set right now, so nothing was changed. Try again in a few minutes.",
  },
  boilerplate: {
    heading: "Boilerplate",
    targetLabel: "Agent tool",
    targets: { "claude-code": "Claude Code" } satisfies Record<BoilerplateTarget, string>,
    submit: "Generate the Boilerplate",
    resultHeading: (target: string) => `Boilerplate for ${target}`,
    ready: (target: string) => `The ${target} Boilerplate is ready to download.`,
    download: "Download the archive",
    artifacts: {
      "identification-file": "Project identification file",
      "dependency-pins": "Dependency pins",
      "design-system-references": "Design-system references",
      "mcp-configuration": "MCP configuration",
      instructions: "Instructions",
      skills: "Skills",
    } satisfies Record<BoilerplateArtifactKind, string>,
    endpointUnset: "The Company Guidance endpoint is not set. Ask the Buyer to set it. Nothing was generated.",
    unavailable: "The Boilerplate is unavailable right now, so nothing was generated. Try again in a few minutes.",
  },
} as const;

/** The forms of the New-application flow surface. */
export type NewApplicationIntent = "place" | "guidance-endpoint" | "boilerplate";

/** What the New-application flow action reports back to the page. */
export interface NewApplicationActionData {
  /** The form that was submitted. */
  readonly intent: NewApplicationIntent;
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: Readonly<Partial<Record<NewApplicationField, string>>>;
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: Readonly<Partial<Record<NewApplicationField, string>>>;
  /**
   * The Application just placed (the place form is emptied after a success),
   * kept through Boilerplate and endpoint submits so the Boilerplate form stays.
   */
  readonly placedId?: string;
  /** The Guidance endpoint form's submitted URL and its field ink, on a refused set. */
  readonly endpoint?: { readonly value: string; readonly error: string | undefined };
  /** The Boilerplate just generated. */
  readonly boilerplate?: BoilerplateResult;
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

const ENDPOINT_FIELD_ID = "guidance-endpoint-url";

export interface GuidanceEndpointFormProps {
  /** The Application just placed, carried so the Boilerplate form stays after this submit. */
  readonly placedId: string | undefined;
  /** The URL field: {@link GuidanceEndpointField} once the state loads, or its busy or unavailable form. */
  readonly children: ReactNode;
}

/**
 * standard-form for the Company Guidance endpoint: the URL field and a
 * secondary button. Shown to every role: the registry refuses anyone but the
 * Buyer, and the refusal is announced as a denial.
 */
export function GuidanceEndpointForm({ placedId, children }: GuidanceEndpointFormProps) {
  return (
    <Form method="post" className="standard-form" aria-labelledby="guidance-endpoint-heading" noValidate>
      <h2 id="guidance-endpoint-heading" className="type-title-sm">
        {NEW_APPLICATION_COPY.endpoint.heading}
      </h2>
      <input type="hidden" name="intent" value="guidance-endpoint" />
      {placedId === undefined ? null : <input type="hidden" name="applicationId" value={placedId} />}
      {children}
      <Button variant="inverse" type="submit">
        {NEW_APPLICATION_COPY.endpoint.submit}
      </Button>
    </Form>
  );
}

export interface GuidanceEndpointFieldProps {
  /** The current state; undefined while it loads or when it is unavailable. */
  readonly state: GuidanceEndpointState | undefined;
  /** True while the state loads. */
  readonly busy?: boolean;
  /** Shown under the field while loading or when unavailable. */
  readonly note?: string | undefined;
  /** A refused set: the submitted URL and its field ink, kept. */
  readonly submitted: NewApplicationActionData["endpoint"];
}

/** The "Guidance endpoint URL" field, filled with the current URL, and a line naming it or saying "Not set.". */
export function GuidanceEndpointField({ state, busy = false, note, submitted }: GuidanceEndpointFieldProps) {
  const error = submitted?.error;
  const current = state?.url;
  return (
    <div className="standard-form__fields" {...(busy ? { "aria-busy": true as const } : {})}>
      <label htmlFor={ENDPOINT_FIELD_ID} className="type-label">
        {NEW_APPLICATION_COPY.endpoint.label}
      </label>
      <input
        key={current ?? ""}
        id={ENDPOINT_FIELD_ID}
        name="url"
        type="url"
        autoComplete="off"
        defaultValue={submitted?.value ?? current ?? ""}
        {...(error === undefined
          ? {}
          : { "aria-invalid": true as const, "aria-describedby": `${ENDPOINT_FIELD_ID}-error` })}
      />
      {error === undefined ? null : (
        <p id={`${ENDPOINT_FIELD_ID}-error`} className="field-error">
          {error}
        </p>
      )}
      {current === undefined ? null : (
        <p>{current === null ? NEW_APPLICATION_COPY.endpoint.notSet : NEW_APPLICATION_COPY.endpoint.current(current)}</p>
      )}
      {note === undefined ? null : <p>{note}</p>}
    </div>
  );
}

/**
 * standard-form for the Boilerplate of the Application just placed: the
 * labelled "Agent tool" select and a secondary button. Shown to every role.
 */
export function BoilerplateForm({ applicationId }: { readonly applicationId: string }) {
  const copy = NEW_APPLICATION_COPY.boilerplate;
  return (
    <Form method="post" className="standard-form" aria-labelledby="boilerplate-heading" noValidate>
      <h2 id="boilerplate-heading" className="type-title-sm">
        {copy.heading}
      </h2>
      <input type="hidden" name="intent" value="boilerplate" />
      <input type="hidden" name="applicationId" value={applicationId} />
      <label htmlFor="boilerplate-target" className="type-label">
        {copy.targetLabel}
      </label>
      <select id="boilerplate-target" name="target" defaultValue="claude-code">
        {Object.entries(copy.targets).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Button variant="inverse" type="submit">
        {copy.submit}
      </Button>
    </Form>
  );
}

/**
 * boilerplate-result: a raised surface listing each artifact in plain text
 * ("<label>: <path>", no badges), and the archive download.
 */
export function BoilerplateResultSection({ result }: { readonly result: BoilerplateResult }) {
  const copy = NEW_APPLICATION_COPY.boilerplate;
  return (
    <section className="boilerplate-result" aria-labelledby="boilerplate-result-heading">
      <h2 id="boilerplate-result-heading" className="type-title-sm">
        {copy.resultHeading(copy.targets[result.target])}
      </h2>
      <ul>
        {result.artifacts.map((artifact) => (
          <li key={artifact.path}>{`${copy.artifacts[artifact.kind]}: ${artifact.path}`}</li>
        ))}
      </ul>
      <a href={`data:application/gzip;base64,${result.archiveBase64}`} download={result.archiveName}>
        {copy.download}
      </a>
    </section>
  );
}
