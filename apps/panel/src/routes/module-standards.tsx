import { useEffect } from "react";
import { data, Link, redirect, useActionData, useLoaderData, useLocation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  CODE_STACK_ENTRY_FIELDS,
  MODULE_HAS_NO_OWNER,
  MODULE_KIND_LABELS,
  MODULE_NOT_FOUND,
  NOT_MODULE_OWNER,
  SESSION_INVALID,
  SLOT_CONFLICT,
  STANDARD_NOT_FOUND,
} from "@domain-harness/contract";
import type { ErrorEnvelope, StandardInfo, StandardList } from "@domain-harness/contract";
import { StandardForm, STANDARDS_COPY } from "../components/standard-form.tsx";
import type { StandardFormActionData, StandardFormValues } from "../components/standard-form.tsx";
import { Status } from "../components/status.tsx";
import { getStandardVersions, listStandards, publishStandard, publishStandardVersion } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Module Standards | Domain Harness" }];

export interface ModuleStandardsLoaderData {
  readonly moduleId: string;
  /** `null` when the Module was not found or the registry could not be reached. */
  readonly list: StandardList | null;
  readonly state: "ok" | "not-found" | "unavailable";
  /** `?edit=<standardId>` when it names a Standard of this Module. */
  readonly editId: string | null;
}

/** The Module's Standards page path, without `?edit`. */
export const moduleStandardsPage = (moduleId: string): string => `/standards/${encodeURIComponent(moduleId)}`;

/**
 * A Module with the live version of each of its Standards. Every role may
 * read; a lapsed session goes back to sign-in; an outage keeps the page
 * structure with a status that Standards are unavailable.
 */
export async function loader({ request, params }: LoaderFunctionArgs): Promise<Response | ModuleStandardsLoaderData> {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const moduleId = params["moduleId"] ?? "";
  const result = await listStandards(token, moduleId);
  if (result.kind === "ok") {
    const edit = new URL(request.url).searchParams.get("edit");
    const editId = result.value.standards.some((standard) => standard.id === edit) ? edit : null;
    return { moduleId, list: result.value, state: "ok", editId };
  }
  if (result.kind === "refused" && result.error.code === SESSION_INVALID) return redirect("/sign-in");
  const state = result.kind === "refused" && result.error.code === MODULE_NOT_FOUND ? "not-found" : "unavailable";
  return { moduleId, list: null, state, editId: null };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * `intent=publish` with the code-stack fields, plus `standardId` when editing.
 * Values go to the registry as submitted: it checks the Module, its owner and
 * the session first, then the entry, then the Conflict slot, so a non-owner's
 * submit is a denial whatever it holds.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  if (field(form, "intent") !== "publish") {
    return data<StandardFormActionData>(
      { status: { tone: "denial", message: STANDARDS_COPY.actionUnavailable }, fieldErrors: {}, values: {} },
      { status: 400 },
    );
  }
  const moduleId = params["moduleId"] ?? "";
  const values = {
    category: field(form, "category"),
    name: field(form, "name"),
    versionConstraint: field(form, "versionConstraint"),
    status: field(form, "status"),
    correctionInstruction: field(form, "correctionInstruction"),
    standardId: field(form, "standardId"),
  };
  const { standardId, ...entry } = values;
  const result =
    standardId === ""
      ? await publishStandard(token, moduleId, entry)
      : await publishStandardVersion(token, standardId, entry);
  if (result.kind === "ok") {
    return data<StandardFormActionData>({
      status: { tone: "notice", message: STANDARDS_COPY.published(result.value) },
      fieldErrors: {},
      values: {},
      published: result.value,
    });
  }
  return refusal(token, values, result.kind === "refused" ? result.error : undefined);
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
async function refusal(token: string, values: Required<StandardFormValues>, error: ErrorEnvelope | undefined) {
  const reply = (status: number, rest: Pick<StandardFormActionData, "status" | "fieldErrors">) =>
    data<StandardFormActionData>({ values, ...rest }, { status });
  const denial = (status: number, message: string) => reply(status, { status: { tone: "denial", message }, fieldErrors: {} });

  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case MODULE_HAS_NO_OWNER:
      return denial(409, STANDARDS_COPY.noOwnerDenial);
    case NOT_MODULE_OWNER:
      return denial(403, STANDARDS_COPY.notOwnerDenial);
    case MODULE_NOT_FOUND:
      return denial(404, STANDARDS_COPY.moduleNotFound);
    case STANDARD_NOT_FOUND:
      return denial(404, STANDARDS_COPY.standardNotFound);
    case SLOT_CONFLICT: {
      const versions = await getStandardVersions(token, error.subject);
      const holder = versions.kind === "ok" ? (versions.value.versions.at(-1) ?? null) : null;
      return denial(409, STANDARDS_COPY.conflict(values, holder, error.subject));
    }
    case "invalid_input": {
      if (error.subject === "entry") return denial(400, STANDARDS_COPY.designSystemDenial);
      const subject = CODE_STACK_ENTRY_FIELDS.find((name) => name === error.subject);
      if (subject !== undefined) {
        return reply(400, { status: null, fieldErrors: { [subject]: STANDARDS_COPY.fieldErrors[subject] } });
      }
      break;
    }
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, STANDARDS_COPY.actionUnavailable);
}

/** A Module's Standards: who owns it, its live Standards, and the code-stack form. */
export default function ModuleStandards() {
  const { moduleId, list, state, editId } = useLoaderData<ModuleStandardsLoaderData>();
  const actionData = useActionData<StandardFormActionData>();
  const location = useLocation();
  const page = moduleStandardsPage(moduleId);

  // Esc or Cancel edit returns focus to the row's Edit link.
  const focusEdit = (location.state as { focusEdit?: unknown } | null)?.focusEdit;
  useEffect(() => {
    if (typeof focusEdit === "string") document.getElementById(`edit-${focusEdit}`)?.focus();
  }, [location.key, focusEdit]);

  const loaderStatus =
    state === "unavailable"
      ? { tone: "denial" as const, message: STANDARDS_COPY.unavailable }
      : state === "not-found"
        ? { tone: "denial" as const, message: STANDARDS_COPY.modulePageNotFound }
        : null;
  const status = actionData?.status ?? loaderStatus;
  const published = actionData?.published;
  const refused = published === undefined ? actionData : undefined;
  // A refused edit stays in edit mode: the form posts to the page without `?edit`.
  const kept = refused?.values.standardId;
  const editingId = kept !== undefined && kept !== "" ? kept : editId;
  const editing = list?.standards.find((standard) => standard.id === editingId) ?? null;
  const module = list?.module;

  return (
    <>
      <h1 className="type-title">{module?.name ?? STANDARDS_COPY.standardsHeading}</h1>
      {module === undefined ? null : (
        <>
          <p>Kind: {MODULE_KIND_LABELS[module.kind]}</p>
          <p>Standard owner: {module.owner?.name ?? STANDARDS_COPY.noOwner}</p>
        </>
      )}
      <p>
        <Link to="/standards">{STANDARDS_COPY.allModules}</Link>
      </p>
      <Status tone={status?.tone ?? "notice"} message={status?.message} />
      {published === undefined ? null : <PublishedFacts info={published} />}
      {list === null ? null : (
        <>
          <section className="standards" aria-labelledby="standards-heading">
            <h2 id="standards-heading" className="type-title-sm">
              {STANDARDS_COPY.standardsHeading}
            </h2>
            {list.standards.length === 0 ? <p>{STANDARDS_COPY.empty}</p> : <StandardsTable standards={list.standards} />}
          </section>
          {list.module.kind === "code-stack" ? (
            <StandardForm
              key={`${editing?.id ?? "new"}:${published === undefined ? "" : `${published.id}:${String(published.version)}`}`}
              action={page}
              editing={editing}
              submitted={refused}
            />
          ) : (
            <p>{STANDARDS_COPY.designSystemNotice}</p>
          )}
        </>
      )}
    </>
  );
}

function PublishedFacts({ info }: { readonly info: StandardInfo }) {
  return (
    <section className="published" aria-labelledby="published-heading">
      <h2 id="published-heading" className="type-title-sm">
        {STANDARDS_COPY.publishedHeading}
      </h2>
      <dl className="published-facts">
        <dt>Standard id</dt>
        <dd>{info.id}</dd>
        <dt>Module</dt>
        <dd>{info.module.name}</dd>
        <dt>Project scope</dt>
        <dd>{info.project.name} (root Project)</dd>
        <dt>Version</dt>
        <dd>{info.version}</dd>
        <dt>Published (UTC)</dt>
        <dd>
          <time dateTime={info.publishedAt}>{info.publishedAt}</time>
        </dd>
      </dl>
    </section>
  );
}

function StandardsTable({ standards }: { readonly standards: readonly StandardInfo[] }) {
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <thead>
          <tr>
            <th scope="col">Standard</th>
            <th scope="col">Category</th>
            <th scope="col">Status</th>
            <th scope="col">Version constraint</th>
            <th scope="col">Version</th>
            <th scope="col">Published (UTC)</th>
            <th scope="col">Standard id</th>
          </tr>
        </thead>
        <tbody>
          {standards.map((standard) => (
            <tr key={standard.id}>
              <th scope="row">
                <p>{standard.entry.name}</p>
                <p className="type-label">
                  <Link id={`edit-${standard.id}`} to={`?edit=${encodeURIComponent(standard.id)}`}>
                    {STANDARDS_COPY.editLink(standard.entry.name)}
                  </Link>
                </p>
              </th>
              <td>{standard.entry.category}</td>
              <td>{standard.entry.status}</td>
              <td>{standard.entry.versionConstraint ?? STANDARDS_COPY.none}</td>
              <td>{standard.version}</td>
              <td>
                <time dateTime={standard.publishedAt}>{standard.publishedAt}</time>
              </td>
              <td>{standard.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
