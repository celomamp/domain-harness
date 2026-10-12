import { Suspense, useEffect } from "react";
import { Await, data, Link, redirect, useActionData, useLoaderData, useLocation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  CODE_STACK_ENTRY_FIELDS,
  DESIGN_SYSTEM_ENTRY_FIELDS,
  entrySlotName,
  isCodeStackEntry,
  isDesignSystemEntry,
  MODULE_HAS_NO_OWNER,
  MODULE_KIND_LABELS,
  MODULE_NOT_FOUND,
  NOT_MODULE_OWNER,
  SESSION_INVALID,
  SLOT_CONFLICT,
  STANDARD_NOT_FOUND,
} from "@domain-harness/contract";
import type {
  DesignSystemEntryRequest,
  ErrorEnvelope,
  StandardInfo,
  StandardList,
  StandardPublishRequest,
} from "@domain-harness/contract";
import { DESIGN_SYSTEM_COPY, DesignSystemForm, splitTokens } from "../components/design-system-form.tsx";
import { StandardForm, STANDARDS_COPY } from "../components/standard-form.tsx";
import type { StandardFormActionData, StandardFormField, StandardFormValues } from "../components/standard-form.tsx";
import { Status } from "../components/status.tsx";
import { getStandardVersions, listStandards, publishStandard, publishStandardVersion } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Module Standards | Domain Harness" }];

export interface ModuleStandardsLoaderData {
  readonly moduleId: string;
  /** `?edit=<standardId>` as requested; it selects a Standard only when that Standard is in this Module. */
  readonly editParam: string | null;
  /** The Standards list, not awaited: the page structure shows (cold-load) while it loads. */
  readonly standards: Promise<RegistryResult<StandardList>>;
}

/** The Module's Standards page path, without `?edit`. */
export const moduleStandardsPage = (moduleId: string): string => `/standards/${encodeURIComponent(moduleId)}`;

/**
 * A Module with the live version of each of its Standards. Every role may
 * read. Without a session cookie the page goes to sign-in; otherwise the list
 * is returned as a pending promise so the structure streams first, and the
 * page shows a lapsed session, an unknown Module or an outage in its status.
 */
export function loader({ request, params }: LoaderFunctionArgs): Response | ModuleStandardsLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const moduleId = params["moduleId"] ?? "";
  const editParam = new URL(request.url).searchParams.get("edit");
  return { moduleId, editParam, standards: listStandards(token, moduleId) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The design-system entry the form describes; a component's tokens are split on commas. */
function designSystemEntry(values: Required<StandardFormValues>): DesignSystemEntryRequest {
  switch (values.kind) {
    case "component":
      return {
        kind: "component",
        name: values.name,
        usageRule: values.usageRule,
        tokens: splitTokens(values.tokens),
        correctionInstruction: values.correctionInstruction,
      };
    case "token":
      return { kind: "token", name: values.name, status: values.status };
    case "import":
      return { kind: "import", specifier: values.specifier, status: values.status };
    default:
      // An unknown kind goes as sent; the registry refuses it on `kind`.
      return { kind: values.kind } as unknown as DesignSystemEntryRequest;
  }
}

/**
 * `intent=publish` with the code-stack fields, or with the design-system
 * fields when `kind` is present, plus `standardId` when editing. Values go to
 * the registry as submitted (tokens split on commas): it checks the Module,
 * its owner and the session first, then the entry, then the Conflict slot,
 * so a non-owner's submit is a denial whatever it holds.
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
  const designSystem = form.has("kind");
  let values: Required<StandardFormValues>;
  let entry: StandardPublishRequest["entry"];
  let proposed: { slotKind: string; slotName: string };
  if (designSystem) {
    const kept = {
      kind: field(form, "kind"),
      name: field(form, "name"),
      usageRule: field(form, "usageRule"),
      tokens: field(form, "tokens"),
      correctionInstruction: field(form, "correctionInstruction"),
      specifier: field(form, "specifier"),
      status: field(form, "status"),
      standardId: field(form, "standardId"),
    };
    values = { ...kept, category: "", versionConstraint: "" };
    entry = designSystemEntry(values);
    proposed = { slotKind: kept.kind, slotName: kept.kind === "import" ? kept.specifier : kept.name };
  } else {
    const kept = {
      category: field(form, "category"),
      name: field(form, "name"),
      versionConstraint: field(form, "versionConstraint"),
      status: field(form, "status"),
      correctionInstruction: field(form, "correctionInstruction"),
      standardId: field(form, "standardId"),
    };
    values = { ...kept, kind: "", usageRule: "", tokens: "", specifier: "" };
    entry = {
      category: kept.category,
      name: kept.name,
      versionConstraint: kept.versionConstraint,
      status: kept.status,
      correctionInstruction: kept.correctionInstruction,
    };
    proposed = { slotKind: kept.category, slotName: kept.name };
  }
  const standardId = values.standardId;
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
  const shown = designSystem ? pick(values, DESIGN_SYSTEM_FORM_FIELDS) : pick(values, CODE_STACK_ENTRY_FIELDS);
  const error = result.kind === "refused" ? result.error : undefined;
  return refusal(token, { values: shown, designSystem, proposed: { ...proposed, standardId } }, error);
}

/** Every field of the design-system form (the union of the three field sets). */
const DESIGN_SYSTEM_FORM_FIELDS: readonly StandardFormField[] = [
  ...new Set(Object.values(DESIGN_SYSTEM_ENTRY_FIELDS).flat()),
];

/** The kept values of one form: its own fields and `standardId`. */
function pick(values: Required<StandardFormValues>, fields: readonly StandardFormField[]): StandardFormValues {
  const kept: Partial<Record<StandardFormField | "standardId", string>> = { standardId: values.standardId };
  for (const name of fields) kept[name] = values[name];
  return kept;
}

interface Submitted {
  readonly values: StandardFormValues;
  /** Whether the design-system form was submitted (it carries `kind`). */
  readonly designSystem: boolean;
  /** The submitted slot kind and name, and the Standard being edited ("" for new). */
  readonly proposed: { readonly slotKind: string; readonly slotName: string; readonly standardId: string };
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
async function refusal(token: string, submitted: Submitted, error: ErrorEnvelope | undefined) {
  const { values, designSystem, proposed } = submitted;
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
      return denial(409, STANDARDS_COPY.conflict(proposed, holder, error.subject));
    }
    case "invalid_input": {
      // Field errors of the submitted form only; `entry` or `kind` on the code-stack form is unexpected.
      if (designSystem) {
        const subject = DESIGN_SYSTEM_FORM_FIELDS.find((name) => name === error.subject) as
          | keyof typeof DESIGN_SYSTEM_COPY.fieldErrors
          | undefined;
        if (subject !== undefined) {
          return reply(400, { status: null, fieldErrors: { [subject]: DESIGN_SYSTEM_COPY.fieldErrors[subject] } });
        }
      } else {
        const subject = CODE_STACK_ENTRY_FIELDS.find((name) => name === error.subject);
        if (subject !== undefined) {
          return reply(400, { status: null, fieldErrors: { [subject]: STANDARDS_COPY.fieldErrors[subject] } });
        }
      }
      break;
    }
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, STANDARDS_COPY.actionUnavailable);
}

/** A Module's Standards: who owns it, its live Standards, and the form for its kind. */
export default function ModuleStandards() {
  const { moduleId, editParam, standards } = useLoaderData<ModuleStandardsLoaderData>();
  return (
    <Suspense fallback={<ColdLoad />}>
      <Await resolve={standards} errorElement={<Loaded moduleId={moduleId} editParam={editParam} result={UNAVAILABLE} />}>
        {(result: RegistryResult<StandardList>) => <Loaded moduleId={moduleId} editParam={editParam} result={result} />}
      </Await>
    </Suspense>
  );
}

const UNAVAILABLE: RegistryResult<StandardList> = { kind: "unavailable" };

/** Shown while the Standards list loads: the page structure, the table header cells and a busy row, no form. */
function ColdLoad() {
  return (
    <>
      <h1 className="type-title">{STANDARDS_COPY.standardsHeading}</h1>
      <p>
        <Link to="/standards">{STANDARDS_COPY.allModules}</Link>
      </p>
      <Status tone="notice" message={undefined} />
      <section className="standards" aria-labelledby="standards-heading">
        <h2 id="standards-heading" className="type-title-sm">
          {STANDARDS_COPY.standardsHeading}
        </h2>
        <div className="table-scroll">
          <table className="standards-table">
            <thead>
              <tr>
                {COLD_LOAD_HEADERS.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody aria-busy="true">
              <tr aria-busy="true">
                <td colSpan={COLD_LOAD_HEADERS.length}>{STANDARDS_COPY.loading}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** The Module's kind is not known until the list arrives, so the cold-load table shows the header cells both tables share. */
const COLD_LOAD_HEADERS = ["Standard", "Status", "Version", "Published (UTC)", "Standard id"] as const;

interface LoadedProps {
  readonly moduleId: string;
  readonly editParam: string | null;
  readonly result: RegistryResult<StandardList>;
}

function Loaded({ moduleId, editParam, result }: LoadedProps) {
  const actionData = useActionData<StandardFormActionData>();
  const location = useLocation();
  const page = moduleStandardsPage(moduleId);

  // Esc or Cancel edit returns focus to the row's Edit link.
  const focusEdit = (location.state as { focusEdit?: unknown } | null)?.focusEdit;
  useEffect(() => {
    if (typeof focusEdit === "string") document.getElementById(`edit-${focusEdit}`)?.focus();
  }, [location.key, focusEdit]);

  const list = result.kind === "ok" ? result.value : null;
  const sessionEnded = result.kind === "refused" && result.error.code === SESSION_INVALID;
  const loaderStatus =
    result.kind === "ok"
      ? null
      : sessionEnded
        ? { tone: "denial" as const, message: STANDARDS_COPY.sessionEnded }
        : result.kind === "refused" && result.error.code === MODULE_NOT_FOUND
          ? { tone: "denial" as const, message: STANDARDS_COPY.modulePageNotFound }
          : { tone: "denial" as const, message: STANDARDS_COPY.unavailable };
  const status = actionData?.status ?? loaderStatus;
  const published = actionData?.published;
  const refused = published === undefined ? actionData : undefined;
  // A refused edit stays in edit mode: the form posts to the page without `?edit`.
  const kept = refused?.values.standardId;
  const editingId = kept !== undefined && kept !== "" ? kept : editParam;
  const editing = list?.standards.find((standard) => standard.id === editingId) ?? null;
  const module = list?.module;
  const formKey = `${editing?.id ?? "new"}:${published === undefined ? "" : `${published.id}:${String(published.version)}`}`;

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
      {sessionEnded ? (
        <p>
          <Link to="/sign-in">{STANDARDS_COPY.signInAgain}</Link>
        </p>
      ) : null}
      {published === undefined ? null : <PublishedFacts info={published} />}
      {list === null ? null : (
        <>
          <section className="standards" aria-labelledby="standards-heading">
            <h2 id="standards-heading" className="type-title-sm">
              {STANDARDS_COPY.standardsHeading}
            </h2>
            {list.standards.length === 0 ? (
              <p>{STANDARDS_COPY.empty}</p>
            ) : list.module.kind === "code-stack" ? (
              <StandardsTable standards={list.standards} />
            ) : (
              <DesignSystemTable standards={list.standards} />
            )}
          </section>
          {list.module.kind === "code-stack" ? (
            <StandardForm key={formKey} action={page} editing={editing} submitted={refused} />
          ) : (
            <DesignSystemForm key={formKey} action={page} editing={editing} submitted={refused} />
          )}
        </>
      )}
    </>
  );
}

/** The row header cell: the Standard's slot name and its Edit link. */
function StandardCell({ standard }: { readonly standard: StandardInfo }) {
  const name = entrySlotName(standard.entry);
  return (
    <th scope="row">
      <p>{name}</p>
      <p className="type-label">
        <Link id={`edit-${standard.id}`} to={`?edit=${encodeURIComponent(standard.id)}`}>
          {STANDARDS_COPY.editLink(name)}
        </Link>
      </p>
    </th>
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
          {standards.map((standard) => {
            const entry = isCodeStackEntry(standard.entry) ? standard.entry : null;
            return (
              <tr key={standard.id}>
                <StandardCell standard={standard} />
                <td>{entry?.category ?? STANDARDS_COPY.none}</td>
                <td>{entry?.status ?? STANDARDS_COPY.none}</td>
                <td>{entry?.versionConstraint ?? STANDARDS_COPY.none}</td>
                <td>{standard.version}</td>
                <td>
                  <time dateTime={standard.publishedAt}>{standard.publishedAt}</time>
                </td>
                <td>{standard.id}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The design-system Standards: one row per component, token or import. */
function DesignSystemTable({ standards }: { readonly standards: readonly StandardInfo[] }) {
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <thead>
          <tr>
            <th scope="col">Standard</th>
            <th scope="col">Entry kind</th>
            <th scope="col">Status</th>
            <th scope="col">Usage rule</th>
            <th scope="col">Tokens</th>
            <th scope="col">Version</th>
            <th scope="col">Published (UTC)</th>
            <th scope="col">Standard id</th>
          </tr>
        </thead>
        <tbody>
          {standards.map((standard) => {
            const entry = isDesignSystemEntry(standard.entry) ? standard.entry : null;
            const component = entry?.kind === "component" ? entry : null;
            const status = entry !== null && entry.kind !== "component" ? entry.status : STANDARDS_COPY.none;
            const tokens = component === null || component.tokens.length === 0 ? STANDARDS_COPY.none : component.tokens.join(", ");
            return (
              <tr key={standard.id}>
                <StandardCell standard={standard} />
                <td>{entry?.kind ?? STANDARDS_COPY.none}</td>
                <td>{status}</td>
                <td>{component?.usageRule ?? STANDARDS_COPY.none}</td>
                <td>{tokens}</td>
                <td>{standard.version}</td>
                <td>
                  <time dateTime={standard.publishedAt}>{standard.publishedAt}</time>
                </td>
                <td>{standard.id}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
