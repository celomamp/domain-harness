import { Suspense } from "react";
import { Await, data, Link, redirect, useActionData, useLoaderData, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { PROJECT_CYCLE, PROJECT_NOT_FOUND, ROLE_DENIED, ROOT_PROJECT_FIXED, SESSION_INVALID } from "@domain-harness/contract";
import type { ErrorEnvelope, ProjectInfo, ProjectTree } from "@domain-harness/contract";
import { ChangeParentForm, CreateProjectForm, PROJECT_TREE_COPY, ProjectTreeView } from "../components/project-tree.tsx";
import type { ProjectFormField, ProjectTreeActionData } from "../components/project-tree.tsx";
import { Status } from "../components/status.tsx";
import { changeProjectParent, createProject, getProjectTree } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Project tree | Domain Harness" }];

export interface ProjectTreeLoaderData {
  /** `?project=<id>` as requested; it selects a node only when that Project is in the tree (default: the root). */
  readonly projectParam: string | null;
  /** The tree, not awaited: the page structure shows (cold-load) while it loads. */
  readonly tree: Promise<RegistryResult<ProjectTree>>;
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
  return { projectParam, tree: getProjectTree(token) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const FORM_FIELDS: readonly ProjectFormField[] = ["name", "levelName", "parentId"];

/**
 * `intent=create` with Name, Level name and Parent, or `intent=parent` with
 * the Project and its new Parent. Values go to the registry as submitted; it
 * checks the session, the Project, the role, the body, the parent, the root
 * and the whole bundle in that order, so a non-Buyer's submit is a denial
 * whatever it holds.
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

interface Submitted {
  readonly intent: "create" | "parent";
  readonly values: ProjectTreeActionData["values"];
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
async function refusal(token: string, submitted: Submitted, error: ErrorEnvelope | undefined) {
  const { intent, values } = submitted;
  const reply = (status: number, rest: Pick<ProjectTreeActionData, "status" | "fieldErrors">) =>
    data<ProjectTreeActionData>({ intent, values, ...rest }, { status });
  const denial = (status: number, message: string) => reply(status, { status: { tone: "denial", message }, fieldErrors: {} });

  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return denial(403, PROJECT_TREE_COPY.roleDenial);
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
  const { projectParam, tree } = useLoaderData<ProjectTreeLoaderData>();
  return (
    <Suspense fallback={<ColdLoad />}>
      <Await resolve={tree} errorElement={<Loaded projectParam={projectParam} result={UNAVAILABLE} />}>
        {(result: RegistryResult<ProjectTree>) => <Loaded projectParam={projectParam} result={result} />}
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
}

function Loaded({ projectParam, result }: LoadedProps) {
  const actionData = useActionData<ProjectTreeActionData>();
  const navigate = useNavigate();
  const tree = result.kind === "ok" ? result.value : null;
  const sessionEnded = result.kind === "refused" && result.error.code === SESSION_INVALID;
  const loaderStatus =
    result.kind === "ok"
      ? null
      : { tone: "denial" as const, message: sessionEnded ? PROJECT_TREE_COPY.sessionEnded : PROJECT_TREE_COPY.unavailable };
  const status = actionData?.status ?? loaderStatus;

  const selected =
    tree?.projects.find((project) => project.id === projectParam) ??
    tree?.projects.find((project) => project.id === tree.rootId) ??
    null;
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
          <section className="project-tree-section" aria-label={PROJECT_TREE_COPY.heading}>
            <ProjectTreeView tree={tree} selectedId={selected.id} onSelect={select} />
            {tree.projects.length === 1 ? <p>{PROJECT_TREE_COPY.empty}</p> : null}
          </section>
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
