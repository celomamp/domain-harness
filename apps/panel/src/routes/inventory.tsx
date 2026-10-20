import { Suspense, useState } from "react";
import { Await, Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type {
  ApplicationInfo,
  ApplicationList,
  InventoryEvidence,
  ProjectInfo,
  ProjectTree,
} from "@domain-harness/contract";
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SectionCard } from "../components/section-card.tsx";
import { Skeleton } from "../components/skeleton.tsx";
import { Stat } from "../components/stat.tsx";
import { Toolbar } from "../components/toolbar.tsx";
import { formatDate } from "../format.ts";
import { getApplications, getInventoryEvidence, getProjectTree } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Inventory | Domain Harness" }];

export const INVENTORY_COPY = {
  eyebrow: "Monitor",
  heading: "Inventory",
  description: "Every Application the Company has placed, grouped by agent tool.",
  newApplication: "New application",
  caption: "Applications",
  headers: ["Application", "Project", "Agent tool", "Status", "Added"],
  fromFlow: "New-application flow",
  registered: "Registered",
  evidence: "Listed before any Gate run. Compilation evidence fills in later.",
  empty: "No Application yet.",
  emptyProject: "No Application in this Project yet.",
  emptySearch: "No Application matches this search.",
  loading: "Loading the Applications…",
  unavailable: "The Inventory is unavailable right now. Try again in a few minutes.",
  filterLabel: "Project",
  filterAll: "All Projects",
  filterLoading: "Loading the Projects…",
  filterUnavailable: "The Project list is unavailable right now. The full list is shown.",
  groupNone: "No Compilation yet",
  evidenceUnavailable:
    "The Compilation evidence did not arrive, so the agent-tool groups use the latest Boilerplate target.",
  searchLabel: "Search applications",
  clearFilter: "Clear filter",
  summary: {
    applications: "Applications",
    projects: "Projects",
    agentTools: "Agent tools",
    notCompiled: "Not yet compiled",
  },
  status: {
    received: "Evidence received",
    none: "No Compilation yet",
    checking: "Checking evidence…",
    unavailable: "Evidence unavailable",
  },
  groupBy: {
    label: "Group by",
    agentTool: "Agent tool",
    project: "Project",
  },
  sort: {
    label: "Sort",
    newest: "Newest",
    name: "Name",
  },
  count: (count: number) => `${String(count)} ${count === 1 ? "Application" : "Applications"}`,
} as const;

export interface InventoryLoaderData {
  /** Every Application of the Company, not awaited: the heading shows first while it loads. */
  readonly applications: Promise<RegistryResult<ApplicationList>>;
  /** The Project tree for the filter, not awaited: the Applications show first while it loads. */
  readonly projects: Promise<RegistryResult<ProjectTree>>;
  /** The per-Application Compilation evidence, not awaited: grouping upgrades when it arrives. */
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

/** Every role may read the Inventory. Without a session cookie the page goes to sign-in. */
export function loader({ request }: LoaderFunctionArgs): Response | InventoryLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return {
    applications: getApplications(token),
    projects: getProjectTree(token),
    evidence: getInventoryEvidence(token),
  };
}

/** One agent-tool group: the heading plus its Applications in registry order. */
export interface ApplicationGroup {
  /** The agent tool, or `""` for Applications with no Compilation yet. */
  readonly key: string;
  readonly heading: string;
  readonly applications: readonly ApplicationInfo[];
}

/**
 * Group Applications under their agent-tool heading in first-appearance
 * order, keeping registry order inside each group. The key is the latest
 * Compilation-observed tool first, the registry Boilerplate target second,
 * and the none-group last resort — so an Application with no Compilation
 * yet still appears, and a missing evidence read degrades to the registry
 * tool without moving rows off the page. The key is trimmed so a whitespace
 * variant of the same tool groups and counts identically.
 */
export function groupApplications(
  applications: readonly ApplicationInfo[],
  evidence: ReadonlyMap<string, readonly string[]>,
): ApplicationGroup[] {
  const groups: { key: string; heading: string; applications: ApplicationInfo[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const application of applications) {
    const observed = evidence.get(application.id) ?? [];
    const key = (observed[0] ?? application.agentTool ?? "").trim();
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, heading: key === "" ? INVENTORY_COPY.groupNone : key, applications: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.applications.push(application);
  }
  return groups;
}

/** Index the evidence read by Application id for the grouping key. */
export function evidenceMap(evidence: InventoryEvidence): Map<string, readonly string[]> {
  return new Map(evidence.applications.map((row) => [row.applicationId, row.agentTools]));
}

/** The evidence read's state, threaded to the rows so the status is never a guess. */
export type EvidenceState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ok"; readonly map: ReadonlyMap<string, readonly string[]> };

/** The Inventory summary: totals plus the evidence-derived counts. */
export interface InventorySummary {
  readonly applications: number;
  readonly projects: number;
  readonly agentTools: number;
  readonly notCompiled: number;
}

/**
 * The summary numbers derived from the reads. `projects` is the Company's
 * total Projects from the Project-tree read (it is passed in, not derivable
 * from the Applications alone). `agentTools` counts the distinct non-empty
 * group keys; `notCompiled` counts Applications with no evidence row.
 */
export function inventorySummary(
  applications: readonly ApplicationInfo[],
  evidence: ReadonlyMap<string, readonly string[]>,
  projects: number,
): InventorySummary {
  const tools = new Set<string>();
  let notCompiled = 0;
  for (const application of applications) {
    const observed = evidence.get(application.id);
    if (observed === undefined) notCompiled += 1;
    const key = (observed?.[0] ?? application.agentTool ?? "").trim();
    if (key !== "") tools.add(key);
  }
  return { applications: applications.length, projects, agentTools: tools.size, notCompiled };
}

/** The sort choices the toolbar offers. */
export type InventorySort = "newest" | "name";

/** A sorted copy (newest first, or by description), leaving the caller's order untouched. */
export function sortApplications(
  applications: readonly ApplicationInfo[],
  sort: InventorySort,
): ApplicationInfo[] {
  const copy = [...applications];
  if (sort === "name") {
    return copy.sort(
      (left, right) => left.description.localeCompare(right.description) || left.id.localeCompare(right.id),
    );
  }
  return copy.sort((left, right) => {
    const newest = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return newest !== 0 ? newest : right.id.localeCompare(left.id);
  });
}

/** The Project filter's "all" sentinel. */
const ALL_PROJECTS = "all";

/** The Applications matching the search (description or Project) and the Project filter. */
export function filterApplications(
  applications: readonly ApplicationInfo[],
  query: string,
  projectId: string,
): ApplicationInfo[] {
  const needle = query.trim().toLowerCase();
  return applications.filter((application) => {
    if (projectId !== ALL_PROJECTS && application.project.id !== projectId) return false;
    if (needle === "") return true;
    return (
      application.description.toLowerCase().includes(needle) ||
      application.project.name.toLowerCase().includes(needle)
    );
  });
}

/** Group Applications under their Project name (the group-by "Project" choice). */
export function groupByProject(applications: readonly ApplicationInfo[]): ApplicationGroup[] {
  const groups: { key: string; heading: string; applications: ApplicationInfo[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const application of applications) {
    let group = byKey.get(application.project.id);
    if (group === undefined) {
      group = { key: application.project.id, heading: application.project.name, applications: [] };
      byKey.set(application.project.id, group);
      groups.push(group);
    }
    group.applications.push(application);
  }
  return groups;
}

/**
 * Inventory: every Application of the Company, grouped under an agent-tool
 * heading and filterable by Project. The structure (heading, Applications)
 * renders first; the Project tree and the Compilation evidence stream in
 * beside it, so a slow or failed evidence read never takes the list down.
 * It never names who created an Application.
 */
export default function Inventory() {
  const { applications, projects, evidence } = useLoaderData<InventoryLoaderData>();
  const unavailable = <Banner tone="notice">{INVENTORY_COPY.unavailable}</Banner>;
  return (
    <>
      <PageHeader
        eyebrow={INVENTORY_COPY.eyebrow}
        title={INVENTORY_COPY.heading}
        description={INVENTORY_COPY.description}
        actions={
          <Link className="button-primary" to="/new-application">
            {INVENTORY_COPY.newApplication}
          </Link>
        }
      />
      <Suspense
        fallback={
          <section aria-label={INVENTORY_COPY.caption} aria-busy="true">
            <Skeleton lines={6} />
          </section>
        }
      >
        <Await resolve={applications} errorElement={unavailable}>
          {(result: RegistryResult<ApplicationList>) =>
            result.kind !== "ok" ? (
              unavailable
            ) : result.value.applications.length === 0 ? (
              <EmptyState
                icon="inventory"
                title={INVENTORY_COPY.empty}
                action={
                  <Link className="button-primary" to="/new-application">
                    {INVENTORY_COPY.newApplication}
                  </Link>
                }
              />
            ) : (
              <LoadedInventory
                applications={result.value.applications}
                projects={projects}
                evidence={evidence}
              />
            )
          }
        </Await>
      </Suspense>
    </>
  );
}

interface LoadedInventoryProps {
  readonly applications: readonly ApplicationInfo[];
  readonly projects: Promise<RegistryResult<ProjectTree>>;
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

/** The Applications are in: resolve the Project tree, then the evidence. */
function LoadedInventory({ applications, projects, evidence }: LoadedInventoryProps) {
  const withoutProjects = <EvidenceLayer applications={applications} projects={null} evidence={evidence} />;
  return (
    <Suspense fallback={<LoadingLayer applications={applications} />}>
      <Await resolve={projects} errorElement={withoutProjects}>
        {(result: RegistryResult<ProjectTree>) =>
          result.kind === "ok" ? (
            <EvidenceLayer applications={applications} projects={result.value.projects} evidence={evidence} />
          ) : (
            withoutProjects
          )
        }
      </Await>
    </Suspense>
  );
}

/** While the Project tree loads: the known Applications count, honest placeholders, and skeleton rows. */
function LoadingLayer({ applications }: { readonly applications: readonly ApplicationInfo[] }) {
  return (
    <>
      <Summary applications={applications.length} projects="—" agentTools="—" notCompiled="—" />
      <section aria-label={INVENTORY_COPY.caption} aria-busy="true">
        <Skeleton lines={6} />
      </section>
    </>
  );
}

interface EvidenceLayerProps {
  readonly applications: readonly ApplicationInfo[];
  readonly projects: readonly ProjectInfo[] | null;
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

/** Resolve the evidence; a miss degrades the grouping with a non-live notice. */
function EvidenceLayer({ applications, projects, evidence }: EvidenceLayerProps) {
  const unavailable = (
    <>
      <Banner tone="notice">{INVENTORY_COPY.evidenceUnavailable}</Banner>
      <InventoryView applications={applications} projects={projects} evidence={{ status: "unavailable" }} />
    </>
  );
  return (
    <Suspense
      fallback={<InventoryView applications={applications} projects={projects} evidence={{ status: "loading" }} />}
    >
      <Await resolve={evidence} errorElement={unavailable}>
        {(result: RegistryResult<InventoryEvidence>) =>
          result.kind === "ok" ? (
            <InventoryView
              applications={applications}
              projects={projects}
              evidence={{ status: "ok", map: evidenceMap(result.value) }}
            />
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

/** The four summary stats. */
function Summary({
  applications,
  projects,
  agentTools,
  notCompiled,
}: {
  readonly applications: number;
  readonly projects: string;
  readonly agentTools: string;
  readonly notCompiled: string;
}) {
  return (
    <div className="inventory-summary">
      <Stat label={INVENTORY_COPY.summary.applications} value={String(applications)} />
      <Stat label={INVENTORY_COPY.summary.projects} value={projects} />
      <Stat label={INVENTORY_COPY.summary.agentTools} value={agentTools} />
      <Stat label={INVENTORY_COPY.summary.notCompiled} value={notCompiled} />
    </div>
  );
}

interface InventoryViewProps {
  readonly applications: readonly ApplicationInfo[];
  readonly projects: readonly ProjectInfo[] | null;
  readonly evidence: EvidenceState;
}

/** The interactive surface: the summary, the toolbar, and the grouped tables. */
function InventoryView({ applications, projects, evidence }: InventoryViewProps) {
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const [groupBy, setGroupBy] = useState<"agentTool" | "project">("agentTool");
  const [sort, setSort] = useState<InventorySort>("newest");

  const resolvedEvidence = evidence.status === "ok" ? evidence.map : new Map<string, readonly string[]>();
  const summary = inventorySummary(applications, resolvedEvidence, projects?.length ?? 0);

  const filtered = filterApplications(applications, query, projectId);
  const sorted = sortApplications(filtered, sort);
  const groups = groupBy === "project" ? groupByProject(sorted) : groupApplications(sorted, resolvedEvidence);

  const projectsText = projects === null ? "—" : String(summary.projects);
  const agentToolsText = evidence.status === "ok" ? String(summary.agentTools) : "—";
  const notCompiledText = evidence.status === "ok" ? String(summary.notCompiled) : "—";

  const clearFilter = () => {
    setQuery("");
    setProjectId(ALL_PROJECTS);
  };

  const emptyTitle = projectId !== ALL_PROJECTS ? INVENTORY_COPY.emptyProject : INVENTORY_COPY.emptySearch;

  return (
    <>
      <Summary
        applications={summary.applications}
        projects={projectsText}
        agentTools={agentToolsText}
        notCompiled={notCompiledText}
      />
      {projects === null ? <Banner tone="notice">{INVENTORY_COPY.filterUnavailable}</Banner> : null}
      <Toolbar
        searchLabel={INVENTORY_COPY.searchLabel}
        searchValue={query}
        onSearch={setQuery}
        filters={
          <>
            {projects === null ? null : (
              <ProjectFilter projects={projects} value={projectId} onChange={setProjectId} />
            )}
            <GroupBySelect value={groupBy} onChange={setGroupBy} />
            <SortSelect value={sort} onChange={setSort} />
          </>
        }
        count={INVENTORY_COPY.count(filtered.length)}
      />
      {filtered.length === 0 ? (
        <EmptyState
          icon="inventory"
          title={emptyTitle}
          action={
            <button type="button" className="button-secondary" onClick={clearFilter}>
              {INVENTORY_COPY.clearFilter}
            </button>
          }
        />
      ) : (
        <div className="inventory-groups">
          {groups.map((group) => (
            <SectionCard key={group.key} title={`${group.heading} · ${String(group.applications.length)}`}>
              <ApplicationTable group={group} evidence={evidence} />
            </SectionCard>
          ))}
        </div>
      )}
    </>
  );
}

/** The single-select Project filter, labelled for the toolbar. */
function ProjectFilter({
  projects,
  value,
  onChange,
}: {
  readonly projects: readonly ProjectInfo[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="inventory-control">
      <span>{INVENTORY_COPY.filterLabel}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        <option value={ALL_PROJECTS}>{INVENTORY_COPY.filterAll}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The group-by control: Agent tool or Project. */
function GroupBySelect({
  value,
  onChange,
}: {
  readonly value: "agentTool" | "project";
  readonly onChange: (value: "agentTool" | "project") => void;
}) {
  return (
    <label className="inventory-control">
      <span>{INVENTORY_COPY.groupBy.label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value as "agentTool" | "project");
        }}
      >
        <option value="agentTool">{INVENTORY_COPY.groupBy.agentTool}</option>
        <option value="project">{INVENTORY_COPY.groupBy.project}</option>
      </select>
    </label>
  );
}

/** The sort control: Newest or Name. */
function SortSelect({
  value,
  onChange,
}: {
  readonly value: InventorySort;
  readonly onChange: (value: InventorySort) => void;
}) {
  return (
    <label className="inventory-control">
      <span>{INVENTORY_COPY.sort.label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value as InventorySort);
        }}
      >
        <option value="newest">{INVENTORY_COPY.sort.newest}</option>
        <option value="name">{INVENTORY_COPY.sort.name}</option>
      </select>
    </label>
  );
}

/** One group's table: Application (link + project), Project, Agent tool, Status, Added. */
function ApplicationTable({
  group,
  evidence,
}: {
  readonly group: ApplicationGroup;
  readonly evidence: EvidenceState;
}) {
  return (
    <div className="inventory-table-scroll" tabIndex={0}>
      <table className="inventory-table">
        <caption>{`${INVENTORY_COPY.caption} — ${group.heading}`}</caption>
        <thead>
          <tr>
            {INVENTORY_COPY.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.applications.map((application) => (
            <ApplicationRow key={application.id} application={application} evidence={evidence} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The per-row agent tool: observed tool first, the registry target second, otherwise "". */
function agentToolOf(application: ApplicationInfo, evidence: EvidenceState): string {
  const observed = evidence.status === "ok" ? evidence.map.get(application.id) : undefined;
  return (observed?.[0] ?? application.agentTool ?? "").trim();
}

/** The status badge for one row, derived from the evidence read's state. */
function statusBadge(
  application: ApplicationInfo,
  evidence: EvidenceState,
): { readonly tone: "neutral" | "outline"; readonly icon: "clock" | "dash" | "check" | "dot"; readonly label: string } {
  if (evidence.status === "loading") {
    return { tone: "neutral", icon: "clock", label: INVENTORY_COPY.status.checking };
  }
  if (evidence.status === "unavailable") {
    return { tone: "neutral", icon: "dash", label: INVENTORY_COPY.status.unavailable };
  }
  if (evidence.map.has(application.id)) {
    return { tone: "outline", icon: "check", label: INVENTORY_COPY.status.received };
  }
  return { tone: "neutral", icon: "dot", label: INVENTORY_COPY.status.none };
}

/** One Application row. Status is read-presence, never a Gate verdict. */
function ApplicationRow({
  application,
  evidence,
}: {
  readonly application: ApplicationInfo;
  readonly evidence: EvidenceState;
}) {
  const agentTool = agentToolOf(application, evidence);
  const status = statusBadge(application, evidence);
  return (
    <tr>
      <th scope="row">
        <Link className="application-name" to={`/applications/${encodeURIComponent(application.id)}`}>
          {application.description}
        </Link>
        <span className="application-project">{application.project.name}</span>
        <span className="application-origin">
          {application.fromFlow ? INVENTORY_COPY.fromFlow : INVENTORY_COPY.registered}
        </span>
      </th>
      <td>{application.project.name}</td>
      <td>{agentTool === "" ? "—" : agentTool}</td>
      <td>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
      </td>
      <td>{formatDate(application.createdAt)}</td>
    </tr>
  );
}
