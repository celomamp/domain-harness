import { Form, Link } from "react-router";
import { MODULE_KIND_LABELS, MODULE_KINDS } from "@domain-harness/contract";
import type { AccountRef, ModuleInfo, ModuleList } from "@domain-harness/contract";
import { Button } from "./button.tsx";
import { Status } from "./status.tsx";

export const MODULES_COPY = {
  empty: "No Module yet.",
  noOwner: "No owner",
  unavailable: "Modules are unavailable right now. Try again in a few minutes.",
  actionUnavailable: "Modules are unavailable right now, so nothing could be saved. Try again in a few minutes.",
  roleDenied: "Only the Buyer can create a Module or assign its Standard owner. Nothing was changed.",
  notFound: "That Module was not found. Nothing was changed.",
  kindError: "Choose a kind: code stack or design system.",
  nameError: "Enter a Module name of 1 to 120 characters.",
  nameTaken: "Another Module already has this name. Enter a different name.",
  ownerError: "Choose a Standard owner account.",
  choosePlaceholder: "Choose a Standard owner",
  created: (name: string) => `Module created: ${name}.`,
  assigned: (owner: string, module: string) => `Standard owner of ${module}: ${owner}.`,
} as const;

/** What the Standards action reports back to the Modules section. */
export interface ModulesActionData {
  readonly intent: "create-module" | "assign-owner" | null;
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: { readonly kind?: string; readonly name?: string; readonly accountId?: string };
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: { readonly kind?: string; readonly name?: string; readonly moduleId?: string; readonly accountId?: string };
  /** Set after a successful create, so the create form starts empty again. */
  readonly createdId?: string;
}

export interface ModulesSectionProps {
  /** `null` when the registry could not be reached. */
  readonly list: ModuleList | null;
  readonly actionData: ModulesActionData | undefined;
}

/**
 * The Modules section of Standards: a table of Modules with their current
 * Standard owner and a per-Module owner form, a create form, and one status
 * region. Every control is shown to every role; the registry decides, and a
 * refusal is announced as a denial.
 */
export function ModulesSection({ list, actionData }: ModulesSectionProps) {
  const status =
    actionData?.status ?? (list === null ? { tone: "denial" as const, message: MODULES_COPY.unavailable } : null);
  const createData = actionData?.intent === "create-module" ? actionData : undefined;
  const assignData = actionData?.intent === "assign-owner" ? actionData : undefined;

  return (
    <section className="modules" aria-labelledby="modules-heading">
      <h2 id="modules-heading" className="type-title-sm">
        Modules
      </h2>
      <Status tone={status?.tone ?? "notice"} message={status?.message} />
      {list === null ? null : list.modules.length === 0 ? (
        <p>{MODULES_COPY.empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="modules-table">
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Kind</th>
                <th scope="col">Standard owner</th>
              </tr>
            </thead>
            <tbody>
              {list.modules.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  standardOwners={list.standardOwners}
                  submitted={assignData?.values.moduleId === module.id ? assignData : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateModuleForm key={createData?.createdId ?? "create"} submitted={createData?.createdId === undefined ? createData : undefined} />
    </section>
  );
}

function ModuleRow({
  module,
  standardOwners,
  submitted,
}: {
  readonly module: ModuleInfo;
  readonly standardOwners: readonly AccountRef[];
  readonly submitted: ModulesActionData | undefined;
}) {
  const selectId = `owner-${module.id}`;
  const errorId = `owner-error-${module.id}`;
  const error = submitted?.fieldErrors.accountId;
  const selected = error !== undefined ? (submitted?.values.accountId ?? "") : (module.owner?.accountId ?? "");
  return (
    <tr>
      <th scope="row">
        <Link to={`/standards/${encodeURIComponent(module.id)}`}>{module.name}</Link>
      </th>
      <td>{MODULE_KIND_LABELS[module.kind]}</td>
      <td>
        {module.owner === null ? (
          <p>{MODULES_COPY.noOwner}</p>
        ) : (
          <>
            <p>{module.owner.name}</p>
            <p className="type-label">
              assigned <time dateTime={module.owner.assignedAt}>{module.owner.assignedAt}</time> by{" "}
              {module.owner.assignedBy.name}
            </p>
          </>
        )}
        <Form method="post" className="module-owner-form" key={`${module.owner?.accountId ?? "none"}-${error ?? ""}`}>
          <input type="hidden" name="intent" value="assign-owner" />
          <input type="hidden" name="moduleId" value={module.id} />
          <label htmlFor={selectId} className="type-label">
            Standard owner for {module.name}
          </label>
          <select
            id={selectId}
            name="accountId"
            defaultValue={selected}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : errorId}
          >
            <option value="">{MODULES_COPY.choosePlaceholder}</option>
            {standardOwners.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.name}
              </option>
            ))}
          </select>
          {error === undefined ? null : (
            <p id={errorId} className="field-error">
              {error}
            </p>
          )}
          <Button variant="inverse" type="submit">
            Assign Standard owner
          </Button>
        </Form>
      </td>
    </tr>
  );
}

function CreateModuleForm({ submitted }: { readonly submitted: ModulesActionData | undefined }) {
  const kindError = submitted?.fieldErrors.kind;
  const nameError = submitted?.fieldErrors.name;
  const kind = submitted?.values.kind;
  return (
    <Form method="post" className="standard-form" aria-labelledby="create-module-heading" noValidate>
      <h3 id="create-module-heading">
        Create a Module
      </h3>
      <input type="hidden" name="intent" value="create-module" />
      <label htmlFor="module-name" className="type-label">
        Module name
      </label>
      <input
        id="module-name"
        name="name"
        type="text"
        autoComplete="off"
        defaultValue={submitted?.values.name ?? ""}
        aria-invalid={nameError === undefined ? undefined : true}
        aria-describedby={nameError === undefined ? undefined : "module-name-error"}
      />
      {nameError === undefined ? null : (
        <p id="module-name-error" className="field-error">
          {nameError}
        </p>
      )}
      <label htmlFor="module-kind" className="type-label">
        Kind
      </label>
      <select
        id="module-kind"
        name="kind"
        defaultValue={kind !== undefined && (MODULE_KINDS as readonly string[]).includes(kind) ? kind : MODULE_KINDS[0]}
        aria-invalid={kindError === undefined ? undefined : true}
        aria-describedby={kindError === undefined ? undefined : "module-kind-error"}
      >
        {MODULE_KINDS.map((value) => (
          <option key={value} value={value}>
            {MODULE_KIND_LABELS[value]}
          </option>
        ))}
      </select>
      {kindError === undefined ? null : (
        <p id="module-kind-error" className="field-error">
          {kindError}
        </p>
      )}
      <Button variant="primary" type="submit">
        Create Module
      </Button>
    </Form>
  );
}
