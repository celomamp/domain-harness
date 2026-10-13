import { Suspense } from "react";
import { Await, data, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { BUILD_GRANT_DENIED, PROJECT_NOT_FOUND, SESSION_INVALID } from "@domain-harness/contract";
import type { ErrorEnvelope, ProjectTree } from "@domain-harness/contract";
import { NEW_APPLICATION_COPY, NewApplicationForm, ProjectField } from "../components/new-application.tsx";
import type { NewApplicationActionData, NewApplicationField } from "../components/new-application.tsx";
import { Status } from "../components/status.tsx";
import { createApplication, getProjectTree } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "New-application flow | Domain Harness" }];

export interface NewApplicationLoaderData {
  /** The Project tree, not awaited: the form structure shows (cold-load) while it loads. */
  readonly tree: Promise<RegistryResult<ProjectTree>>;
}

/**
 * The New-application flow. Every role may open it. Without a session cookie
 * the page goes to sign-in; otherwise the tree is returned as a pending
 * promise so the form structure streams first.
 */
export function loader({ request }: LoaderFunctionArgs): Response | NewApplicationLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { tree: getProjectTree(token) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The name of one Project of the tree, or its id when the tree cannot be read. */
async function projectName(token: string, projectId: string): Promise<string> {
  const tree = await getProjectTree(token);
  return (tree.kind === "ok" ? tree.value.projects.find((project) => project.id === projectId)?.name : undefined) ?? projectId;
}

/**
 * Place the Application with the Description and Project as submitted. The
 * registry checks the session, the body, the Project and the build grant in
 * that order; nothing is created on any refusal, and the submitted values
 * are kept.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  const values = { description: field(form, "description"), projectId: field(form, "projectId") };
  const result = await createApplication(token, values);
  if (result.kind === "ok") {
    return data<NewApplicationActionData>({
      status: { tone: "notice", message: NEW_APPLICATION_COPY.placed(result.value.project.name) },
      fieldErrors: {},
      values: {},
      placedId: result.value.id,
    });
  }
  return refusal(token, values, result.kind === "refused" ? result.error : undefined);
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
async function refusal(token: string, values: NewApplicationActionData["values"], error: ErrorEnvelope | undefined) {
  const denial = (status: number, message: string) =>
    data<NewApplicationActionData>({ status: { tone: "denial", message }, fieldErrors: {}, values }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case "invalid_input": {
      const subject = (["description", "projectId"] as const).find((name: NewApplicationField) => name === error.subject);
      if (subject !== undefined) {
        return data<NewApplicationActionData>(
          { status: null, fieldErrors: { [subject]: NEW_APPLICATION_COPY.fieldErrors[subject] }, values },
          { status: 400 },
        );
      }
      break;
    }
    case BUILD_GRANT_DENIED:
      return denial(403, NEW_APPLICATION_COPY.buildGrantDenied(await projectName(token, values.projectId ?? "")));
    case PROJECT_NOT_FOUND:
      return denial(404, NEW_APPLICATION_COPY.projectNotFound);
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, NEW_APPLICATION_COPY.actionUnavailable);
}

/** The New-application flow surface: the heading, the status region and the form. */
export default function NewApplicationPage() {
  const { tree } = useLoaderData<NewApplicationLoaderData>();
  const actionData = useActionData<NewApplicationActionData>();
  // A success remounts the form empty; a refusal keeps the submitted values.
  const formKey = actionData?.placedId ?? "form";
  const submitted = actionData?.placedId === undefined ? actionData : undefined;
  const unavailable = <ProjectField projects={[]} note={NEW_APPLICATION_COPY.unavailable} submitted={submitted} />;
  return (
    <>
      <h1 className="type-title">{NEW_APPLICATION_COPY.heading}</h1>
      <Status tone={actionData?.status?.tone ?? "notice"} message={actionData?.status?.message} />
      <NewApplicationForm key={formKey} submitted={submitted}>
        <Suspense fallback={<ProjectField projects={[]} busy note={NEW_APPLICATION_COPY.loading} submitted={submitted} />}>
          <Await resolve={tree} errorElement={unavailable}>
            {(result: RegistryResult<ProjectTree>) =>
              result.kind === "ok" ? (
                <ProjectField projects={result.value.projects} submitted={submitted} />
              ) : (
                unavailable
              )
            }
          </Await>
        </Suspense>
      </NewApplicationForm>
    </>
  );
}
