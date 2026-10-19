import { Suspense, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Await, data, Link, redirect, useActionData, useLoaderData, useLocation, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  CODE_STACK_CATEGORIES,
  CODE_STACK_ENTRY_FIELDS,
  CODE_STACK_STATUSES,
  DESIGN_SYSTEM_ENTRY_FIELDS,
  DESIGN_SYSTEM_ENTRY_KINDS,
  DESIGN_SYSTEM_STATUSES,
  entrySlotName,
  isCodeStackEntry,
  isDesignSystemEntry,
  LOCKED_RULE_CONFLICT,
  MODULE_HAS_NO_OWNER,
  MODULE_KIND_LABELS,
  MODULE_NOT_FOUND,
  NOT_MODULE_OWNER,
  PROJECT_NOT_FOUND,
  SESSION_INVALID,
  SLOT_CONFLICT,
  STANDARD_NOT_FOUND,
} from "@domain-harness/contract";
import type {
  DesignSystemEntryField,
  DesignSystemEntryRequest,
  ErrorEnvelope,
  ModuleKind,
  ProjectTree,
  StandardInfo,
  StandardList,
  StandardPublishRequest,
} from "@domain-harness/contract";
import { designSystemFormHeading, DESIGN_SYSTEM_COPY, DesignSystemForm, splitTokens } from "../components/design-system-form.tsx";
import { standardFormHeading, StandardForm, STANDARDS_COPY } from "../components/standard-form.tsx";
import type { StandardFormActionData, StandardFormField, StandardFormValues } from "../components/standard-form.tsx";
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { Breadcrumbs } from "../components/breadcrumbs.tsx";
import { Button } from "../components/button.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SideSheet } from "../components/side-sheet.tsx";
import { Stat } from "../components/stat.tsx";
import { Status } from "../components/status.tsx";
import { Toolbar } from "../components/toolbar.tsx";
import type { SortState } from "../components/data-table.tsx";
import { sortRows } from "../components/data-table.tsx";
import { formatDateTime } from "../format.ts";
import {
  getProjectTree,
  getStandardVersions,
  listStandards,
  publishStandard,
  publishStandardVersion,
} from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Module Standards | Domain Harness" }];

export interface ModuleStandardsLoaderData {
  readonly moduleId: string;
  /** `?edit=<standardId>` as requested; it selects a Standard only when that Standard is in this Module. */
  readonly editParam: string | null;
  /** The Standards list, not awaited: the page structure shows (cold-load) while it loads. */
  readonly standards: Promise<RegistryResult<StandardList>>;
  /** The Project tree for the Project scope picker, not awaited; it never rejects (a failure is `unavailable`). */
  readonly tree: Promise<RegistryResult<ProjectTree>>;
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
  return {
    moduleId,
    editParam,
    standards: listStandards(token, moduleId),
    tree: getProjectTree(token).catch((): RegistryResult<ProjectTree> => ({ kind: "unavailable" })),
  };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The design-system entry the form describes; a component's tokens are split on commas. */
function designSystemEntry(values: Required<Omit<StandardFormValues, "projectId">>): DesignSystemEntryRequest {
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
 * fields when `kind` is present, plus `standardId` when editing, or the
 * Project scope `projectId` when publishing a new Standard (read only then;
 * missing when the Project tree was unavailable, so the registry uses the
 * root Project). Values go to
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
  let values: Required<Omit<StandardFormValues, "projectId">>;
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
  // The Project scope is fixed once published, so only a new Standard sends one.
  const projectId = standardId === "" && form.has("projectId") ? field(form, "projectId") : undefined;
  const result =
    standardId === ""
      ? await publishStandard(token, moduleId, entry, projectId)
      : await publishStandardVersion(token, standardId, entry);
  if (result.kind === "ok") {
    return data<StandardFormActionData>({
      status: { tone: "notice", message: STANDARDS_COPY.published(result.value) },
      fieldErrors: {},
      values: {},
      published: result.value,
    });
  }
  const picked = designSystem ? pick(values, DESIGN_SYSTEM_FORM_FIELDS) : pick(values, CODE_STACK_ENTRY_FIELDS);
  const shown: StandardFormValues = projectId === undefined ? picked : { ...picked, projectId };
  const error = result.kind === "refused" ? result.error : undefined;
  return refusal(token, { values: shown, designSystem, proposed: { ...proposed, standardId } }, error);
}

/** Every field of the design-system form (the union of the three field sets). */
const DESIGN_SYSTEM_FORM_FIELDS: readonly DesignSystemEntryField[] = [
  ...new Set(Object.values(DESIGN_SYSTEM_ENTRY_FIELDS).flat()),
];

/** The kept values of one form: its own fields and `standardId`. */
function pick(
  values: Required<Omit<StandardFormValues, "projectId">>,
  fields: readonly Exclude<StandardFormField, "projectId">[],
): StandardFormValues {
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
    case PROJECT_NOT_FOUND:
      return reply(404, { status: null, fieldErrors: { projectId: STANDARDS_COPY.projectScopeError } });
    case SLOT_CONFLICT: {
      const versions = await getStandardVersions(token, error.subject);
      const holder = versions.kind === "ok" ? (versions.value.versions.at(-1) ?? null) : null;
      return denial(409, STANDARDS_COPY.conflict(proposed, holder, error.subject));
    }
    case LOCKED_RULE_CONFLICT:
      return denial(409, STANDARDS_COPY.lockedRuleConflict);
    case "invalid_input": {
      if (error.subject === "projectId") {
        return reply(400, { status: null, fieldErrors: { projectId: STANDARDS_COPY.projectScopeError } });
      }
      // Field errors of the submitted form only; `entry` or `kind` on the code-stack form is unexpected.
      if (designSystem) {
        const subject = DESIGN_SYSTEM_FORM_FIELDS.find((name) => name === error.subject);
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

/** The summary of a Standard list: how many, across how many Projects, and when last published. */
export function standardsSummary(list: StandardList): { standards: number; projects: number; lastPublished: string } {
  const projects = new Set(list.standards.map((standard) => standard.project.id)).size;
  let latest: string | null = null;
  for (const standard of list.standards) {
    if (latest === null || standard.publishedAt > latest) latest = standard.publishedAt;
  }
  return {
    standards: list.standards.length,
    projects,
    lastPublished: latest === null ? "—" : formatDateTime(latest),
  };
}

/** A Module's Standards: who owns it, its live Standards, and the form for its kind. */
export default function ModuleStandards() {
  const { moduleId, editParam, standards, tree } = useLoaderData<ModuleStandardsLoaderData>();
  // Both promises suspend to the one boundary, so the cold-load shows until both have settled.
  const withTree = (result: RegistryResult<StandardList>) => (
    <Await
      resolve={tree}
      errorElement={<Loaded moduleId={moduleId} editParam={editParam} result={result} projectTree={null} />}
    >
      {(treeResult: RegistryResult<ProjectTree>) => (
        <Loaded
          moduleId={moduleId}
          editParam={editParam}
          result={result}
          projectTree={treeResult.kind === "ok" ? treeResult.value : null}
        />
      )}
    </Await>
  );
  return (
    <Suspense fallback={<ColdLoad />}>
      <Await resolve={standards} errorElement={withTree(UNAVAILABLE)}>
        {(result: RegistryResult<StandardList>) => withTree(result)}
      </Await>
    </Suspense>
  );
}

const UNAVAILABLE: RegistryResult<StandardList> = { kind: "unavailable" };

/** Shown while the Standards list loads: the page structure, the table header cells and a busy row, no form. */
function ColdLoad() {
  return (
    <>
      <PageHeader title={STANDARDS_COPY.standardsHeading} />
      <Status tone="notice" message={undefined} />
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
    </>
  );
}

/** The Module's kind is not known until the list arrives, so the cold-load table shows the header cells both tables share. */
const COLD_LOAD_HEADERS = ["Standard", "Project scope", "Status", "Version", "Published (UTC)"] as const;

interface LoadedProps {
  readonly moduleId: string;
  readonly editParam: string | null;
  readonly result: RegistryResult<StandardList>;
  /** The Project tree for the Project scope picker, or null when it is unavailable. */
  readonly projectTree: ProjectTree | null;
}

function Loaded({ moduleId, editParam, result, projectTree }: LoadedProps) {
  const actionData = useActionData<StandardFormActionData>();
  const location = useLocation();
  const navigate = useNavigate();
  const page = moduleStandardsPage(moduleId);

  // Esc or Cancel edit returns focus to the row's name link.
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
  const editing =
    published === undefined ? (list?.standards.find((standard) => standard.id === editingId) ?? null) : null;
  const module = list?.module;
  const formKey = `${editing?.id ?? "new"}:${published === undefined ? "" : `${published.id}:${String(published.version)}`}`;

  const [publishOpen, setPublishOpen] = useState(false);
  useEffect(() => {
    if (published !== undefined) setPublishOpen(false);
  }, [published]);

  // Closing in edit mode leaves `?edit=`; a new-publish sheet just closes.
  const closeSheet = useCallback(() => {
    if (editing !== null) {
      void navigate(page, { state: { focusEdit: editing.id }, preventScrollReset: true });
    } else {
      setPublishOpen(false);
    }
  }, [editing, navigate, page]);

  const sheetOpen = publishOpen || editing !== null;
  const heading =
    module?.kind === "code-stack" ? standardFormHeading(editing) : designSystemFormHeading(editing);

  return (
    <>
      {module === undefined ? null : (
        <Breadcrumbs
          items={[{ label: STANDARDS_COPY.standardsHeading, to: "/standards" }, { label: module.name }]}
        />
      )}
      <PageHeader
        title={module?.name ?? STANDARDS_COPY.standardsHeading}
        meta={
          module === undefined ? null : (
            <>
              <Badge tone="neutral">{MODULE_KIND_LABELS[module.kind]}</Badge>
              <span>Standard owner: {module.owner?.name ?? STANDARDS_COPY.noOwner}</span>
            </>
          )
        }
        actions={
          module === undefined ? null : (
            <Button
              variant="primary"
              onClick={() => {
                setPublishOpen(true);
              }}
            >
              Publish standard
            </Button>
          )
        }
      />
      <Status tone={status?.tone ?? "notice"} message={status?.message} />
      {sessionEnded ? (
        <p>
          <Link to="/sign-in">{STANDARDS_COPY.signInAgain}</Link>
        </p>
      ) : null}
      {published === undefined ? null : <PublishedFacts info={published} />}
      {list === null ? null : (
        <>
          <div className="standards-summary">
            {summaryStats(list)}
          </div>
          <StandardsSection standards={list.standards} moduleKind={list.module.kind} />
        </>
      )}
      {module === undefined ? null : (
        <SideSheet open={sheetOpen} onClose={closeSheet} title={heading}>
          {list?.module.kind === "code-stack" ? (
            <StandardForm key={formKey} action={page} editing={editing} submitted={refused} projectTree={projectTree} />
          ) : (
            <DesignSystemForm
              key={formKey}
              action={page}
              editing={editing}
              submitted={refused}
              projectTree={projectTree}
            />
          )}
        </SideSheet>
      )}
    </>
  );
}

function summaryStats(list: StandardList) {
  const summary = standardsSummary(list);
  return (
    <>
      <Stat label="Standards" value={String(summary.standards)} />
      <Stat label="Projects scoped" value={String(summary.projects)} />
      <Stat label="Last published" value={summary.lastPublished} />
    </>
  );
}

/** The entry-kind of a Standard: a code-stack category or a design-system entry kind. */
function entryKind(standard: StandardInfo): string {
  const entry = standard.entry;
  return isCodeStackEntry(entry) ? entry.category : entry.kind;
}

/** The status of a Standard: a component has none. */
function entryStatus(standard: StandardInfo): string {
  const entry = standard.entry;
  if (isCodeStackEntry(entry)) return entry.status;
  return entry.kind === "component" ? "" : entry.status;
}

const CODE_STACK_COLUMNS = [
  "Standard",
  "Project scope",
  "Category",
  "Status",
  "Version constraint",
  "Version",
  "Published (UTC)",
] as const;

const DESIGN_SYSTEM_COLUMNS = [
  "Standard",
  "Project scope",
  "Entry kind",
  "Status",
  "Usage rule",
  "Tokens",
  "Version",
  "Published (UTC)",
] as const;

type SortOption = "default" | "name-asc" | "name-desc" | "version-desc" | "published-desc";

const SORT_OPTIONS: readonly { readonly value: SortOption; readonly label: string; readonly sort: SortState | null }[] = [
  { value: "default", label: "Default order", sort: null },
  { value: "name-asc", label: "Name (A to Z)", sort: { column: "name", direction: "asc" } },
  { value: "name-desc", label: "Name (Z to A)", sort: { column: "name", direction: "desc" } },
  { value: "version-desc", label: "Version (newest first)", sort: { column: "version", direction: "desc" } },
  { value: "published-desc", label: "Published (newest first)", sort: { column: "published", direction: "desc" } },
];

/** The summary, toolbar and table of a Module's Standards. */
function StandardsSection({
  standards,
  moduleKind,
}: {
  readonly standards: readonly StandardInfo[];
  readonly moduleKind: ModuleKind;
}) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortOption>("default");

  const kindOptions = moduleKind === "code-stack" ? CODE_STACK_CATEGORIES : DESIGN_SYSTEM_ENTRY_KINDS;
  const statusOptions = moduleKind === "code-stack" ? CODE_STACK_STATUSES : DESIGN_SYSTEM_STATUSES;
  const sort = SORT_OPTIONS.find((option) => option.value === sortKey)?.sort ?? null;

  const visible = standards.filter((standard) => {
    if (search !== "" && !entrySlotName(standard.entry).toLowerCase().includes(search.toLowerCase())) return false;
    if (kindFilter !== "all" && entryKind(standard) !== kindFilter) return false;
    if (statusFilter !== "all" && entryStatus(standard) !== statusFilter) return false;
    return true;
  });
  const sorted = sortRows(visible, sort, (standard, column) => {
    switch (column) {
      case "name":
        return entrySlotName(standard.entry);
      case "project":
        return standard.project.name;
      case "status":
        return entryStatus(standard);
      case "version":
        return standard.version;
      case "published":
        return standard.publishedAt;
      default:
        return entrySlotName(standard.entry);
    }
  });

  return (
    <>
      <Toolbar
        searchLabel="Search standards"
        searchValue={search}
        onSearch={setSearch}
        filters={
          <>
            <label className="standards-filter">
              <span>{moduleKind === "code-stack" ? "Category" : "Entry kind"}</span>
              <select
                value={kindFilter}
                onChange={(event) => {
                  setKindFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                {kindOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="standards-filter">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">All</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="standards-filter">
              <span>Sort</span>
              <select
                value={sortKey}
                onChange={(event) => {
                  setSortKey(event.target.value as SortOption);
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
        count={`${String(sorted.length)} of ${String(standards.length)} Standards`}
      />
      {standards.length === 0 ? (
        <EmptyState icon="standards" title={STANDARDS_COPY.empty} />
      ) : sorted.length === 0 ? (
        <EmptyState icon="standards" title={STANDARDS_COPY.empty} description="No Standard matches the filters." />
      ) : (
        <StandardsTable standards={sorted} moduleKind={moduleKind} />
      )}
    </>
  );
}

function StandardsTable({
  standards,
  moduleKind,
}: {
  readonly standards: readonly StandardInfo[];
  readonly moduleKind: ModuleKind;
}) {
  const columns = moduleKind === "code-stack" ? CODE_STACK_COLUMNS : DESIGN_SYSTEM_COLUMNS;
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <caption className="type-label">{STANDARDS_COPY.standardsHeading}</caption>
        <thead>
          <tr>
            {columns.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
            <th scope="col">
              <span className="visually-hidden">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {standards.map((standard) => (
            <StandardRow key={standard.id} standard={standard} moduleKind={moduleKind} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandardRow({ standard, moduleKind }: { readonly standard: StandardInfo; readonly moduleKind: ModuleKind }) {
  const [open, setOpen] = useState(false);
  const name = entrySlotName(standard.entry);
  const columnCount = (moduleKind === "code-stack" ? CODE_STACK_COLUMNS : DESIGN_SYSTEM_COLUMNS).length;
  const cells =
    moduleKind === "code-stack"
      ? codeStackCells(standard)
      : designSystemCells(standard);
  return (
    <>
      <tr>
        <th scope="row">
          <Link className="standard-name" id={`edit-${standard.id}`} to={`?edit=${encodeURIComponent(standard.id)}`}>
            {name}
          </Link>
        </th>
        {cells.map((cell, index) => (
          <td key={index}>{cell}</td>
        ))}
        <td>
          <button
            type="button"
            className="standard-detail-toggle"
            aria-expanded={open}
            aria-controls={`standard-detail-${standard.id}`}
            onClick={() => {
              setOpen((expanded) => !expanded);
            }}
          >
            {open ? "Hide details" : "Show details"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={`standard-detail-${standard.id}`} className="standard-detail">
          <td colSpan={columnCount + 1}>
            <span className="type-label">Standard id</span>{" "}
            <span className="standard-detail__id">{standard.id}</span> <CopyButton value={standard.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function codeStackCells(standard: StandardInfo): ReactNode[] {
  const entry = isCodeStackEntry(standard.entry) ? standard.entry : null;
  return [
    standard.project.name,
    entry?.category ?? STANDARDS_COPY.none,
    entry?.status ?? STANDARDS_COPY.none,
    entry?.versionConstraint ?? STANDARDS_COPY.none,
    String(standard.version),
    <time dateTime={standard.publishedAt}>{formatDateTime(standard.publishedAt)}</time>,
  ];
}

function designSystemCells(standard: StandardInfo): ReactNode[] {
  const entry = isDesignSystemEntry(standard.entry) ? standard.entry : null;
  const component = entry?.kind === "component" ? entry : null;
  const status = entry !== null && entry.kind !== "component" ? entry.status : STANDARDS_COPY.none;
  const tokens = component === null || component.tokens.length === 0 ? STANDARDS_COPY.none : component.tokens.join(", ");
  return [
    standard.project.name,
    entry?.kind ?? STANDARDS_COPY.none,
    status,
    component?.usageRule ?? STANDARDS_COPY.none,
    tokens,
    String(standard.version),
    <time dateTime={standard.publishedAt}>{formatDateTime(standard.publishedAt)}</time>,
  ];
}

function PublishedFacts({ info }: { readonly info: StandardInfo }) {
  return (
    <Banner tone="success" title={STANDARDS_COPY.publishedHeading}>
      <dl className="published-facts">
        <dt>Standard id</dt>
        <dd className="published-facts__id">
          {info.id} <CopyButton value={info.id} />
        </dd>
        <dt>Version</dt>
        <dd>{info.version}</dd>
        <dt>Project scope</dt>
        <dd>{info.project.name}</dd>
        <dt>Published (UTC)</dt>
        <dd>
          <time dateTime={info.publishedAt}>{formatDateTime(info.publishedAt)}</time>
        </dd>
      </dl>
    </Banner>
  );
}
