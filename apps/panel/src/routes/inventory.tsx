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
import { getApplications, getInventoryEvidence, getProjectTree } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Inventory | Domain Harness" }];

export const INVENTORY_COPY = {
  heading: "Inventory",
  caption: "Applications",
  headers: ["Application", "Project", "Placement", "Listed"],
  fromFlow: "New-application flow",
  registered: "Registered",
  evidence: "Listed before any Gate run. Compilation evidence fills in later.",
  empty: "No Application yet.",
  emptyProject: "No Application in this Project yet.",
  loading: "Loading the Applications…",
  unavailable: "The Inventory is unavailable right now. Try again in a few minutes.",
  filterLabel: "Project",
  filterAll: "All Projects",
  filterLoading: "Loading the Projects…",
  filterUnavailable: "The Project list is unavailable right now. The full list is shown.",
  groupNone: "No Compilation yet",
  evidenceUnavailable:
    "The Compilation evidence did not arrive, so the agent-tool groups use the latest Boilerplate target.",
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
 * tool without moving rows off the page.
 */
export function groupApplications(
  applications: readonly ApplicationInfo[],
  evidence: ReadonlyMap<string, readonly string[]>,
): ApplicationGroup[] {
  const groups: { key: string; heading: string; applications: ApplicationInfo[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const application of applications) {
    const observed = evidence.get(application.id) ?? [];
    const key = observed[0] ?? application.agentTool ?? "";
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

/**
 * Inventory: every Application of the Company, grouped under an agent-tool
 * heading and filterable by Project. The structure (heading, Applications)
 * renders first; the Project tree and the Compilation evidence stream in
 * beside it, so a slow or failed evidence read never takes the list down.
 * It never names who created an Application.
 */
export default function Inventory() {
  const { applications, projects, evidence } = useLoaderData<InventoryLoaderData>();
  const unavailable = <p>{INVENTORY_COPY.unavailable}</p>;
  return (
    <>
      <h1 className="type-title">{INVENTORY_COPY.heading}</h1>
      <Suspense
        fallback={
          <section aria-label={INVENTORY_COPY.caption} aria-busy="true">
            <p>{INVENTORY_COPY.loading}</p>
          </section>
        }
      >
        <Await resolve={applications} errorElement={unavailable}>
          {(result: RegistryResult<ApplicationList>) =>
            result.kind !== "ok" ? (
              unavailable
            ) : result.value.applications.length === 0 ? (
              <p className="type-display">{INVENTORY_COPY.empty}</p>
            ) : (
              <FilteredInventory applications={result.value.applications} projects={projects} evidence={evidence} />
            )
          }
        </Await>
      </Suspense>
    </>
  );
}

interface FilteredInventoryProps {
  readonly applications: readonly ApplicationInfo[];
  readonly projects: Promise<RegistryResult<ProjectTree>>;
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

/** The Project filter around the evidence groups: tree failure keeps the full list with a note. */
function FilteredInventory({ applications, projects, evidence }: FilteredInventoryProps) {
  const withoutFilter = (
    <>
      <p>{INVENTORY_COPY.filterUnavailable}</p>
      <EvidenceGroups applications={applications} evidence={evidence} />
    </>
  );
  return (
    <Suspense fallback={<p>{INVENTORY_COPY.filterLoading}</p>}>
      <Await resolve={projects} errorElement={withoutFilter}>
        {(result: RegistryResult<ProjectTree>) =>
          result.kind !== "ok" ? (
            withoutFilter
          ) : (
            <ProjectFilter applications={applications} projects={result.value.projects} evidence={evidence} />
          )
        }
      </Await>
    </Suspense>
  );
}

interface ProjectFilterProps {
  readonly applications: readonly ApplicationInfo[];
  readonly projects: readonly ProjectInfo[];
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

const ALL_PROJECTS = "all";

/** Single-select Project filter (exact Project only): the list shows that Project's Applications. */
function ProjectFilter({ applications, projects, evidence }: ProjectFilterProps) {
  const [selected, setSelected] = useState<string>(ALL_PROJECTS);
  const visible = selected === ALL_PROJECTS ? applications : applications.filter((app) => app.project.id === selected);
  return (
    <>
      <div className="project-filter">
        <label htmlFor="project-filter">{INVENTORY_COPY.filterLabel}</label>
        <select id="project-filter" value={selected} onChange={(event) => { setSelected(event.target.value); }}>
          <option value={ALL_PROJECTS}>{INVENTORY_COPY.filterAll}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {visible.length === 0 ? (
        <p className="type-display">{INVENTORY_COPY.emptyProject}</p>
      ) : (
        <EvidenceGroups applications={visible} evidence={evidence} />
      )}
    </>
  );
}

interface EvidenceGroupsProps {
  readonly applications: readonly ApplicationInfo[];
  readonly evidence: Promise<RegistryResult<InventoryEvidence>>;
}

/**
 * The Compilation evidence around the grouped tables: while it loads the
 * groups fall back to the registry tool, and when it never arrives the
 * structure stays with a note saying so.
 */
function EvidenceGroups({ applications, evidence }: EvidenceGroupsProps) {
  const fallbackGroups = <GroupedTables applications={applications} evidence={new Map()} />;
  const withoutEvidence = (
    <>
      <p>{INVENTORY_COPY.evidenceUnavailable}</p>
      {fallbackGroups}
    </>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={INVENTORY_COPY.caption} aria-busy="true">
          {fallbackGroups}
        </section>
      }
    >
      <Await resolve={evidence} errorElement={withoutEvidence}>
        {(result: RegistryResult<InventoryEvidence>) =>
          result.kind !== "ok" ? withoutEvidence : <GroupedTables applications={applications} evidence={evidenceMap(result.value)} />
        }
      </Await>
    </Suspense>
  );
}

function GroupedTables({
  applications,
  evidence,
}: {
  readonly applications: readonly ApplicationInfo[];
  readonly evidence: ReadonlyMap<string, readonly string[]>;
}) {
  return (
    <>
      {groupApplications(applications, evidence).map((group) => (
        <section key={group.key} aria-label={`${INVENTORY_COPY.caption} — ${group.heading}`}>
          <h2 className="type-title-sm">{group.heading}</h2>
          <div className="table-scroll">
            <table className="standards-table">
              <caption className="type-title-sm">
                {INVENTORY_COPY.caption} — {group.heading}
              </caption>
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
                  <tr key={application.id} className="application-row">
                    <th scope="row">
                      <Link to={`/applications/${encodeURIComponent(application.id)}`}>{application.description}</Link>
                    </th>
                    <td>{application.project.name}</td>
                    <td>{application.fromFlow ? INVENTORY_COPY.fromFlow : INVENTORY_COPY.registered}</td>
                    <td>{application.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p>{INVENTORY_COPY.evidence}</p>
    </>
  );
}
