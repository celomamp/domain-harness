import { Suspense } from "react";
import { Await, data, Link, redirect, useActionData, useLoaderData, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  CHILD_PERMISSION_DENIED,
  entrySlotKind,
  entrySlotName,
  LOCKED_RULE_CONFLICT,
  PLAN_REFUSED,
  PROJECT_CYCLE,
  PROJECT_NOT_FOUND,
  ROLE_DENIED,
  ROOT_PROJECT_FIXED,
  SESSION_INVALID,
  STANDARD_NOT_FOUND,
} from "@domain-harness/contract";
import type {
  BuildGrantList,
  ChildPermissionList,
  EffectiveStandardSet,
  ErrorEnvelope,
  ProjectInfo,
  ProjectTree,
  StandardInfo,
} from "@domain-harness/contract";
import {
  BuildGrantPanel,
  BuildGrantSection,
  ChangeParentForm,
  ChildPermissionPanel,
  ChildPermissionSection,
  CreateProjectForm,
  EffectiveSetLoading,
  EffectiveSetSection,
  EffectiveSetTable,
  PROJECT_TREE_COPY,
  ProjectTreeView,
} from "../components/project-tree.tsx";
import type { ProjectFormField, ProjectTreeActionData } from "../components/project-tree.tsx";
import { Status } from "../components/status.tsx";
import {
  changeProjectParent,
  createProject,
  getBuildGrants,
  getChildPermissions,
  getEffectiveStandards,
  getProjectTree,
  getStandardVersions,
  setBuildGrant,
  setChildPermission,
  setLockedRule,
} from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Project tree | Domain Harness" }];

export interface ProjectTreeLoaderData {
  /** `?project=<id>` as requested; it selects a node only when that Project is in the tree (default: the root). */
  readonly projectParam: string | null;
  /** The tree, not awaited: the page structure shows (cold-load) while it loads. */
  readonly tree: Promise<RegistryResult<ProjectTree>>;
  /**
   * The selected Project's Effective Standard set, not awaited: chained off
   * the tree so it resolves the same selection (the param when it is in the
   * tree, otherwise the root). The tree shows first while it loads.
   */
  readonly effective: Promise<RegistryResult<EffectiveStandardSet>>;
  /**
   * The selected Project's child-Project permission grants, not awaited:
   * chained off the tree in the same way as `effective`.
   */
  readonly permissions: Promise<RegistryResult<ChildPermissionList>>;
  /** The selected Project's build grants, not awaited: chained off the tree in the same way as `effective`. */
  readonly builds: Promise<RegistryResult<BuildGrantList>>;
}

/** The selected Project: `?project=` when it is in the tree, otherwise the root. */
export function selectedProject(tree: ProjectTree, projectParam: string | null): ProjectInfo | null {
  return (
    tree.projects.find((project) => project.id === projectParam) ??
    tree.projects.find((project) => project.id === tree.rootId) ??
    null
  );
}

const PAGE = "/projects";

/**
 * The Company's Project tree. Every role may read. Without a session cookie
 * the page goes to sign-in; otherwise the tree is returned as a pending
 * promise so the structure streams first.
 */
export function loader({ request }: LoaderFunctionArgs): Response | ProjectTreeLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const projectParam = new URL(request.url).searchParams.get("project");
  const tree = getProjectTree(token);
  const effective = tree.then((result): Promise<RegistryResult<EffectiveStandardSet>> | RegistryResult<EffectiveStandardSet> => {
    const selected = result.kind === "ok" ? selectedProject(result.value, projectParam) : null;
    return selected === null ? SET_UNAVAILABLE : getEffectiveStandards(token, selected.id);
  });
  const permissions = tree.then((result): Promise<RegistryResult<ChildPermissionList>> | RegistryResult<ChildPermissionList> => {
    const selected = result.kind === "ok" ? selectedProject(result.value, projectParam) : null;
    return selected === null ? PERMISSIONS_UNAVAILABLE : getChildPermissions(token, selected.id);
  });
  const builds = tree.then((result): Promise<RegistryResult<BuildGrantList>> | RegistryResult<BuildGrantList> => {
    const selected = result.kind === "ok" ? selectedProject(result.value, projectParam) : null;
    return selected === null ? BUILDS_UNAVAILABLE : getBuildGrants(token, selected.id);
  });
  return { projectParam, tree, effective, permissions, builds };
}

const SET_UNAVAILABLE: RegistryResult<EffectiveStandardSet> = { kind: "unavailable" };
const PERMISSIONS_UNAVAILABLE: RegistryResult<ChildPermissionList> = { kind: "unavailable" };
const BUILDS_UNAVAILABLE: RegistryResult<BuildGrantList> = { kind: "unavailable" };

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const FORM_FIELDS: readonly ProjectFormField[] = ["name", "levelName", "parentId"];

/**
 * `intent=create` with Name, Level name and Parent, `intent=parent` with
 * the Project and its new Parent, `intent=lock` with a Standard and its
 * new Locked-rule state (`locked` = "true" or "false"), or
 * `intent=permission` with a Project, an account and its new child-Project
 * permission state (`granted` = "true" or "false"), or `intent=build` with a
 * Project, an account and its new build grant state. Values go to the
 * registry as submitted; it checks the session, the Project or Standard, the
 * role, the body and the whole bundle in that order, so a non-Buyer's submit
 * is a denial whatever it holds.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "create") {
    const values = { name: field(form, "name"), levelName: field(form, "levelName"), parentId: field(form, "parentId") };
    const result = await createProject(token, values);
    if (result.kind === "ok") return success(token, "create", result.value);
    return refusal(token, { intent, values }, result.kind === "refused" ? result.error : undefined);
  }
  if (intent === "parent") {
    const values = { projectId: field(form, "projectId"), parentId: field(form, "parentId") };
    const result = await changeProjectParent(token, values.projectId, values.parentId);
    if (result.kind === "ok") return success(token, "parent", result.value);
    return refusal(token, { intent, values }, result.kind === "refused" ? result.error : undefined);
  }
  if (intent === "lock") {
    const values = { standardId: field(form, "standardId"), locked: field(form, "locked") };
    if (values.locked === "true" || values.locked === "false") {
      const result = await setLockedRule(token, values.standardId, values.locked === "true");
      if (result.kind === "ok") {
        const { standard, locked } = result.value;
        const slot = PROJECT_TREE_COPY.effective.slot(slotOf(standard));
        const message = locked
          ? PROJECT_TREE_COPY.locked.marked(slot, standard.project.name)
          : PROJECT_TREE_COPY.locked.unmarked(slot, standard.project.name);
        return data<ProjectTreeActionData>({ intent, status: { tone: "notice", message }, fieldErrors: {}, values: {} });
      }
      return refusal(token, { intent, values }, result.kind === "refused" ? result.error : undefined);
    }
    return refusal(token, { intent, values }, undefined);
  }
  if (intent === "permission") {
    const values = { projectId: field(form, "projectId"), accountId: field(form, "accountId"), granted: field(form, "granted") };
    if (values.granted === "true" || values.granted === "false") {
      const result = await setChildPermission(token, values.projectId, values.accountId, values.granted === "true");
      if (result.kind === "ok") {
        const { account, project, granted } = result.value;
        const message = granted
          ? PROJECT_TREE_COPY.permission.granted(account.name, project.name)
          : PROJECT_TREE_COPY.permission.revoked(account.name, project.name);
        return data<ProjectTreeActionData>({ intent, status: { tone: "notice", message }, fieldErrors: {}, values: {} });
      }
      return refusal(token, { intent, values }, result.kind === "refused" ? result.error : undefined);
    }
    return refusal(token, { intent, values }, undefined);
  }
  if (intent === "build") {
    const values = { projectId: field(form, "projectId"), accountId: field(form, "accountId"), granted: field(form, "granted") };
    if (values.granted === "true" || values.granted === "false") {
      const result = await setBuildGrant(token, values.projectId, values.accountId, values.granted === "true");
      if (result.kind === "ok") {
        const { account, project, granted } = result.value;
        const message = granted
          ? PROJECT_TREE_COPY.build.granted(account.name, project.name)
          : PROJECT_TREE_COPY.build.revoked(account.name, project.name);
        return data<ProjectTreeActionData>({ intent, status: { tone: "notice", message }, fieldErrors: {}, values: {} });
      }
      return refusal(token, { intent, values }, result.kind === "refused" ? result.error : undefined);
    }
    return refusal(token, { intent, values }, undefined);
  }
  return data<ProjectTreeActionData>(
    { intent: "", status: { tone: "denial", message: PROJECT_TREE_COPY.actionUnavailable }, fieldErrors: {}, values: {} },
    { status: 400 },
  );
}

/** The names of the tree's Projects by id, or an empty map when the tree cannot be read. */
async function projectNames(token: string): Promise<Map<string, string>> {
  const tree = await getProjectTree(token);
  return new Map(tree.kind === "ok" ? tree.value.projects.map((project) => [project.id, project.name]) : []);
}

async function success(token: string, intent: "create" | "parent", project: ProjectInfo) {
  const parentId = project.parentId ?? "";
  const parentName = (await projectNames(token)).get(parentId) ?? parentId;
  const message =
    intent === "create" ? PROJECT_TREE_COPY.created(project, parentName) : PROJECT_TREE_COPY.moved(project, parentName);
  return data<ProjectTreeActionData>({
    intent,
    status: { tone: "notice", message },
    fieldErrors: {},
    values: {},
    changed: project,
  });
}

/** The Conflict slot of a Standard's live version. */
const slotOf = (standard: StandardInfo) => ({
  moduleKind: standard.module.kind,
  slotKind: entrySlotKind(standard.entry),
  name: entrySlotName(standard.entry),
});

/** "<slot> on <Project>" for a Standard's latest version, or its id when it cannot be read. */
async function describeRule(token: string, standardId: string): Promise<string> {
  const versions = await getStandardVersions(token, standardId);
  const latest = versions.kind === "ok" ? versions.value.versions.at(-1) : undefined;
  if (latest === undefined) return standardId;
  return PROJECT_TREE_COPY.locked.rule(PROJECT_TREE_COPY.effective.slot(slotOf(latest)), latest.project.name);
}

interface Submitted {
  readonly intent: "create" | "parent" | "lock" | "permission" | "build";
  readonly values: ProjectTreeActionData["values"];
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
async function refusal(token: string, submitted: Submitted, error: ErrorEnvelope | undefined) {
  const { intent, values } = submitted;
  const reply = (status: number, rest: Pick<ProjectTreeActionData, "status" | "fieldErrors">) =>
    data<ProjectTreeActionData>({ intent, values, ...rest }, { status });
  const denial = (status: number, message: string) => reply(status, { status: { tone: "denial", message }, fieldErrors: {} });
  // A plan refusal leaves the top status empty and shows in place inside the
  // submitted form or section; the submitted values are kept.
  if (error?.code === PLAN_REFUSED && intent !== "permission" && intent !== "build") {
    return data<ProjectTreeActionData>(
      { intent, values, status: null, fieldErrors: {}, planRefusal: PROJECT_TREE_COPY.planRefusal[intent] },
      { status: 403 },
    );
  }

  if (intent === "lock") {
    switch (error?.code) {
      case SESSION_INVALID:
        return redirect("/sign-in");
      case ROLE_DENIED:
        return denial(403, PROJECT_TREE_COPY.locked.roleDenial);
      case STANDARD_NOT_FOUND:
        return denial(404, PROJECT_TREE_COPY.locked.standardNotFound);
      case LOCKED_RULE_CONFLICT: {
        const [rule, other] = await Promise.all([
          describeRule(token, values.standardId ?? ""),
          describeRule(token, error.subject),
        ]);
        return denial(409, PROJECT_TREE_COPY.locked.conflict(rule, other));
      }
      default:
        // invalid_input, any other refusal, or an outage.
        return denial(503, PROJECT_TREE_COPY.actionUnavailable);
    }
  }

  if (intent === "permission" || intent === "build") {
    const copy = intent === "permission" ? PROJECT_TREE_COPY.permission : PROJECT_TREE_COPY.build;
    switch (error?.code) {
      case SESSION_INVALID:
        return redirect("/sign-in");
      case ROLE_DENIED:
        return denial(403, copy.roleDenial);
      case PROJECT_NOT_FOUND:
        return denial(404, PROJECT_TREE_COPY.projectNotFound);
      case "invalid_input":
        if (error.subject === "accountId") return denial(400, copy.invalidAccount);
        return denial(503, PROJECT_TREE_COPY.actionUnavailable);
      default:
        // Any other refusal, or an outage.
        return denial(503, PROJECT_TREE_COPY.actionUnavailable);
    }
  }

  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return denial(403, PROJECT_TREE_COPY.roleDenial);
    case CHILD_PERMISSION_DENIED: {
      const parentId = values.parentId ?? "";
      const parentName = (await projectNames(token)).get(parentId) ?? parentId;
      return denial(403, PROJECT_TREE_COPY.permission.createDenied(parentName));
    }
    case ROOT_PROJECT_FIXED:
      return denial(409, PROJECT_TREE_COPY.rootFixed);
    case PROJECT_NOT_FOUND:
      if (error.subject === "parentId") {
        return reply(404, { status: null, fieldErrors: { parentId: PROJECT_TREE_COPY.fieldErrors.parentId } });
      }
      return denial(404, PROJECT_TREE_COPY.projectNotFound);
    case PROJECT_CYCLE: {
      const names = await projectNames(token);
      const projectId = values.projectId ?? "";
      const parentName = names.get(error.subject) ?? error.subject;
      const projectName = names.get(projectId) ?? projectId;
      return denial(409, PROJECT_TREE_COPY.cycle(parentName, projectName, error.subject === projectId));
    }
    case "invalid_input": {
      const subject = FORM_FIELDS.find((name) => name === error.subject);
      if (subject !== undefined) {
        return reply(400, { status: null, fieldErrors: { [subject]: PROJECT_TREE_COPY.fieldErrors[subject] } });
      }
      break;
    }
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, PROJECT_TREE_COPY.actionUnavailable);
}

/** The Project tree surface: the tree, then the forms to create a Project and change a parent. */
export default function ProjectTreePage() {
  const { projectParam, tree, effective, permissions, builds } = useLoaderData<ProjectTreeLoaderData>();
  return (
    <Suspense fallback={<ColdLoad />}>
      <Await
        resolve={tree}
        errorElement={
          <Loaded
            projectParam={projectParam}
            result={UNAVAILABLE}
            effective={effective}
            permissions={permissions}
            builds={builds}
          />
        }
      >
        {(result: RegistryResult<ProjectTree>) => (
          <Loaded
            projectParam={projectParam}
            result={result}
            effective={effective}
            permissions={permissions}
            builds={builds}
          />
        )}
      </Await>
    </Suspense>
  );
}

const UNAVAILABLE: RegistryResult<ProjectTree> = { kind: "unavailable" };

/** Shown while the tree loads: the heading, the status region and a busy tree region, no forms. */
function ColdLoad() {
  return (
    <>
      <h1 className="type-title">{PROJECT_TREE_COPY.heading}</h1>
      <Status tone="notice" message={undefined} />
      <section className="project-tree-section" aria-label={PROJECT_TREE_COPY.heading} aria-busy="true">
        <p>{PROJECT_TREE_COPY.loading}</p>
      </section>
    </>
  );
}

interface LoadedProps {
  readonly projectParam: string | null;
  readonly result: RegistryResult<ProjectTree>;
  readonly effective: Promise<RegistryResult<EffectiveStandardSet>>;
  readonly permissions: Promise<RegistryResult<ChildPermissionList>>;
  readonly builds: Promise<RegistryResult<BuildGrantList>>;
}

function Loaded({ projectParam, result, effective, permissions, builds }: LoadedProps) {
  const actionData = useActionData<ProjectTreeActionData>();
  const navigate = useNavigate();
  const tree = result.kind === "ok" ? result.value : null;
  const sessionEnded = result.kind === "refused" && result.error.code === SESSION_INVALID;
  const loaderStatus =
    result.kind === "ok"
      ? null
      : { tone: "denial" as const, message: sessionEnded ? PROJECT_TREE_COPY.sessionEnded : PROJECT_TREE_COPY.unavailable };
  const status = actionData?.status ?? loaderStatus;

  const selected = tree === null ? null : selectedProject(tree, projectParam);
  const refused = actionData?.changed === undefined ? actionData : undefined;
  // A success remounts the forms empty; a refusal keeps the submitted values.
  const formKey = `${selected?.id ?? ""}:${actionData?.changed === undefined ? "" : `${actionData.changed.id}:${actionData.changed.parentId ?? ""}`}`;
  const select = (projectId: string) => {
    void navigate(`${PAGE}?project=${encodeURIComponent(projectId)}`, { preventScrollReset: true });
  };

  return (
    <>
      <h1 className="type-title">{PROJECT_TREE_COPY.heading}</h1>
      <Status tone={status?.tone ?? "notice"} message={status?.message} />
      {sessionEnded ? (
        <p>
          <Link to="/sign-in">{PROJECT_TREE_COPY.signInAgain}</Link>
        </p>
      ) : null}
      {tree === null || selected === null ? null : (
        <>
          <div className="project-tree-layout">
            <section className="project-tree-section" aria-label={PROJECT_TREE_COPY.heading}>
              <ProjectTreeView tree={tree} selectedId={selected.id} onSelect={select} />
              {tree.projects.length === 1 ? <p>{PROJECT_TREE_COPY.empty}</p> : null}
            </section>
            <div className="project-tree-side">
              <EffectiveSet
                projectName={selected.name}
                effective={effective}
                planRefusal={actionData?.intent === "lock" ? actionData.planRefusal : undefined}
              />
              <ChildPermissions projectName={selected.name} permissions={permissions} />
              <BuildGrants projectName={selected.name} builds={builds} />
            </div>
          </div>
          <CreateProjectForm
            key={`create:${formKey}`}
            tree={tree}
            selected={selected}
            submitted={refused?.intent === "create" ? refused : undefined}
          />
          {selected.parentId === null ? null : (
            <ChangeParentForm
              key={`parent:${formKey}`}
              tree={tree}
              selected={selected}
              submitted={refused?.intent === "parent" ? refused : undefined}
            />
          )}
        </>
      )}
    </>
  );
}

interface EffectiveSetProps {
  readonly projectName: string;
  readonly effective: Promise<RegistryResult<EffectiveStandardSet>>;
  /** A plan refusal of a Locked-rule mark, shown in place above the table. */
  readonly planRefusal: string | undefined;
}

/**
 * The selected Project's Effective Standard set under its own Suspense: the
 * tree and forms show first, the section is busy while the set loads, and a
 * failure shows the unavailable text without touching the tree or forms.
 */
function EffectiveSet({ projectName, effective, planRefusal }: EffectiveSetProps) {
  const unavailable = (
    <EffectiveSetSection projectName={projectName} planRefusal={planRefusal}>
      <p>{PROJECT_TREE_COPY.effective.unavailable}</p>
    </EffectiveSetSection>
  );
  return (
    <Suspense
      fallback={
        <EffectiveSetSection projectName={projectName} planRefusal={planRefusal} busy>
          <EffectiveSetLoading />
        </EffectiveSetSection>
      }
    >
      <Await resolve={effective} errorElement={unavailable}>
        {(result: RegistryResult<EffectiveStandardSet>) =>
          result.kind === "ok" ? (
            <EffectiveSetSection projectName={projectName} planRefusal={planRefusal}>
              <EffectiveSetTable set={result.value} />
            </EffectiveSetSection>
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

interface ChildPermissionsProps {
  readonly projectName: string;
  readonly permissions: Promise<RegistryResult<ChildPermissionList>>;
}

/**
 * The selected Project's child-Project permission under its own Suspense:
 * busy while the grants load, and a failure shows the unavailable text
 * without touching the tree, the table or the forms.
 */
function ChildPermissions({ projectName, permissions }: ChildPermissionsProps) {
  const copy = PROJECT_TREE_COPY.permission;
  const unavailable = (
    <ChildPermissionSection projectName={projectName}>
      <p>{copy.unavailable}</p>
    </ChildPermissionSection>
  );
  return (
    <Suspense
      fallback={
        <ChildPermissionSection projectName={projectName} busy>
          <p>{copy.loading}</p>
        </ChildPermissionSection>
      }
    >
      <Await resolve={permissions} errorElement={unavailable}>
        {(result: RegistryResult<ChildPermissionList>) =>
          result.kind === "ok" ? (
            <ChildPermissionSection projectName={projectName}>
              <ChildPermissionPanel list={result.value} />
            </ChildPermissionSection>
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

interface BuildGrantsProps {
  readonly projectName: string;
  readonly builds: Promise<RegistryResult<BuildGrantList>>;
}

/**
 * The selected Project's build grants under their own Suspense: busy while
 * the grants load, and a failure shows the unavailable text without touching
 * the tree, the table, the child-Project permission or the forms.
 */
function BuildGrants({ projectName, builds }: BuildGrantsProps) {
  const copy = PROJECT_TREE_COPY.build;
  const unavailable = (
    <BuildGrantSection projectName={projectName}>
      <p>{copy.unavailable}</p>
    </BuildGrantSection>
  );
  return (
    <Suspense
      fallback={
        <BuildGrantSection projectName={projectName} busy>
          <p>{copy.loading}</p>
        </BuildGrantSection>
      }
    >
      <Await resolve={builds} errorElement={unavailable}>
        {(result: RegistryResult<BuildGrantList>) =>
          result.kind === "ok" ? (
            <BuildGrantSection projectName={projectName}>
              <BuildGrantPanel list={result.value} />
            </BuildGrantSection>
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}
