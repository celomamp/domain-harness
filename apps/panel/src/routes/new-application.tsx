import { Suspense, useEffect, useState } from "react";
import { Await, data, redirect, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  BOILERPLATE_CONFLICT,
  BUILD_GRANT_DENIED,
  GUIDANCE_ENDPOINT_UNSET,
  PROJECT_NOT_FOUND,
  ROLE_DENIED,
  SESSION_INVALID,
  UNSUPPORTED_ECOSYSTEM,
} from "@domain-harness/contract";
import type { ErrorEnvelope, GuidanceEndpointState, ProjectTree, Role } from "@domain-harness/contract";
import {
  BoilerplateForm,
  BoilerplateResultSection,
  GuidanceEndpointField,
  GuidanceEndpointForm,
  NEW_APPLICATION_COPY,
  NewApplicationForm,
  ProjectField,
  REGISTER_FIELD_PREFIX,
  RegisterApplicationForm,
  RegistrationResultSection,
} from "../components/new-application.tsx";
import type { NewApplicationActionData, NewApplicationField } from "../components/new-application.tsx";
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SectionCard } from "../components/section-card.tsx";
import { Status } from "../components/status.tsx";
import { Tabs } from "../components/tabs.tsx";
import {
  createApplication,
  generateBoilerplate,
  getGuidanceEndpoint,
  getProjectTree,
  registerApplication,
  setGuidanceEndpoint,
} from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "New-application flow | Domain Harness" }];

export interface NewApplicationLoaderData {
  /** The Project tree, not awaited: the form structure shows (cold-load) while it loads. */
  readonly tree: Promise<RegistryResult<ProjectTree>>;
  /** The Company Guidance endpoint, not awaited either. */
  readonly endpoint: Promise<RegistryResult<GuidanceEndpointState>>;
}

/**
 * The New-application flow. Every role may open it. Without a session cookie
 * the page goes to sign-in; otherwise the tree and the Guidance endpoint are
 * returned as pending promises so the form structure streams first.
 */
export function loader({ request }: LoaderFunctionArgs): Response | NewApplicationLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { tree: getProjectTree(token), endpoint: getGuidanceEndpoint(token) };
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
 * One of four forms, by `intent`: `guidance-endpoint` sets the Company
 * Guidance endpoint URL (the registry allows only the Buyer);
 * `boilerplate` generates the Boilerplate of the Application just placed;
 * `register` registers an existing Application (the registry allows only the
 * Buyer); anything else places the Application with the Description and
 * Project as submitted. The registry checks the session, the body, the
 * Project and the grant in that order; nothing is created on any refusal,
 * and the submitted values are kept.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "guidance-endpoint") return endpointAction(token, field(form, "url"), optional(field(form, "applicationId")));
  if (intent === "boilerplate") return boilerplateAction(token, field(form, "applicationId"), field(form, "target"));
  if (intent === "register") return registerAction(token, field(form, "description"), field(form, "projectId"));
  const values = { description: field(form, "description"), projectId: field(form, "projectId") };
  const result = await createApplication(token, values);
  if (result.kind === "ok") {
    return data<NewApplicationActionData>({
      intent: "place",
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
    data<NewApplicationActionData>({ intent: "place", status: { tone: "denial", message }, fieldErrors: {}, values }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case "invalid_input": {
      const subject = (["description", "projectId"] as const).find((name: NewApplicationField) => name === error.subject);
      if (subject !== undefined) {
        return data<NewApplicationActionData>(
          { intent: "place", status: null, fieldErrors: { [subject]: NEW_APPLICATION_COPY.fieldErrors[subject] }, values },
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

const optional = (value: string): string | undefined => (value === "" ? undefined : value);

/**
 * Register an existing Application; a refusal keeps the submitted values.
 * The registry checks the role before the body, so a non-Buyer's refusal is
 * `role_denied` whatever was submitted.
 */
async function registerAction(token: string, description: string, projectId: string) {
  const copy = NEW_APPLICATION_COPY.register;
  const values = { description, projectId };
  const base = { intent: "register" as const, fieldErrors: {}, values };
  const result = await registerApplication(token, values);
  if (result.kind === "ok") {
    return data<NewApplicationActionData>({
      ...base,
      status: { tone: "notice", message: copy.registered(result.value.fileName) },
      registration: result.value,
    });
  }
  const error = result.kind === "refused" ? result.error : undefined;
  const denial = (status: number, message: string) =>
    data<NewApplicationActionData>({ ...base, status: { tone: "denial", message } }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return denial(403, copy.roleDenied);
    case PROJECT_NOT_FOUND:
      return denial(404, copy.projectNotFound);
    case "invalid_input": {
      const subject = (["description", "projectId"] as const).find((name: NewApplicationField) => name === error.subject);
      if (subject !== undefined) {
        return data<NewApplicationActionData>(
          { ...base, status: null, fieldErrors: { [subject]: NEW_APPLICATION_COPY.fieldErrors[subject] } },
          { status: 400 },
        );
      }
      break;
    }
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, copy.actionUnavailable);
}

/** Set the Company Guidance endpoint; a refusal keeps the submitted URL. `placedId` is carried back. */
async function endpointAction(token: string, url: string, placedId: string | undefined) {
  const copy = NEW_APPLICATION_COPY.endpoint;
  const base = { intent: "guidance-endpoint" as const, fieldErrors: {}, values: {}, ...(placedId === undefined ? {} : { placedId }) };
  const result = await setGuidanceEndpoint(token, url);
  if (result.kind === "ok") {
    return data<NewApplicationActionData>({ ...base, status: { tone: "notice", message: copy.set(result.value.url ?? url) } });
  }
  const error = result.kind === "refused" ? result.error : undefined;
  const kept = (status: number, message: string | null, fieldError?: string) =>
    data<NewApplicationActionData>(
      {
        ...base,
        status: message === null ? null : { tone: "denial", message },
        endpoint: { value: url, error: fieldError },
      },
      { status },
    );
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return kept(403, copy.roleDenied);
    case "invalid_input":
      return kept(400, null, copy.fieldError);
    default:
      return kept(503, copy.actionUnavailable);
  }
}

/** The registry's one sentence, ended with a full stop for display. */
const sentence = (message: string): string => (/[.!?]$/.test(message) ? message : `${message}.`);

/** Generate the Boilerplate of `applicationId`; the Boilerplate form stays visible on every outcome. */
async function boilerplateAction(token: string, applicationId: string, target: string) {
  const copy = NEW_APPLICATION_COPY.boilerplate;
  const base = { intent: "boilerplate" as const, fieldErrors: {}, values: {}, placedId: applicationId };
  const result = await generateBoilerplate(token, applicationId, target);
  if (result.kind === "ok") {
    const tool = copy.targets[result.value.target];
    return data<NewApplicationActionData>({
      ...base,
      status: { tone: "notice", message: copy.ready(tool) },
      boilerplate: result.value,
    });
  }
  const error = result.kind === "refused" ? result.error : undefined;
  const denial = (status: number, message: string) =>
    data<NewApplicationActionData>({ ...base, status: { tone: "denial", message } }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case GUIDANCE_ENDPOINT_UNSET:
      return denial(409, copy.endpointUnset);
    case UNSUPPORTED_ECOSYSTEM:
    case BOILERPLATE_CONFLICT:
      return denial(409, sentence(error.message));
    default:
      // A misrouted registry, an outage, an unknown Application or target.
      return denial(503, copy.unavailable);
  }
}

export type NewApplicationStep = "place" | "boilerplate" | "result";

/** The rail describes progress from action data without gating access to a tab. */
export function newApplicationStep(actionData: NewApplicationActionData | undefined): NewApplicationStep {
  if (actionData?.boilerplate !== undefined) return "result";
  if (actionData?.placedId !== undefined) return "boilerplate";
  return "place";
}

type NewApplicationTab = "place" | "generate" | "register";

const APPLICATION_TABS = [
  { id: "place", label: "Place an application", panelId: "place-panel" },
  { id: "generate", label: "Generate Boilerplate", panelId: "generate-panel" },
  { id: "register", label: "Register existing", panelId: "register-panel" },
] as const;

const flowDescription = (role: Role) =>
  role === "Buyer"
    ? "Buyers can place an Application, register existing Applications, and manage the Company Guidance endpoint."
    : "Builders place an Application on a Project where they have a build grant. Ask the Buyer to register existing Applications or manage the Company Guidance endpoint.";

/** The New-application flow surface: its explanatory rail, tabs and role-aware forms. */
export default function NewApplicationPage() {
  const { tree, endpoint } = useLoaderData<NewApplicationLoaderData>();
  const actionData = useActionData<NewApplicationActionData>();
  const panelLayout = useRouteLoaderData<{ readonly role?: Role }>("routes/panel-layout");
  const role = panelLayout?.role ?? "Builder";
  const [activeTab, setActiveTab] = useState<NewApplicationTab>("place");
  useEffect(() => {
    if (actionData?.intent === "register") {
      setActiveTab("register");
    } else if (actionData?.placedId !== undefined) {
      setActiveTab("generate");
    } else if (actionData?.intent === "place") {
      setActiveTab("place");
    }
  }, [actionData]);
  // A success remounts the form empty; a refusal keeps the submitted values.
  const formKey = actionData?.placedId ?? "form";
  const submitted = actionData?.intent === "place" && actionData.placedId === undefined ? actionData : undefined;
  const unavailable = (
    <>
      <Banner tone="denial">{NEW_APPLICATION_COPY.unavailable}</Banner>
      <ProjectField projects={[]} submitted={submitted} />
    </>
  );
  // The register form: cleared after a successful registration (the file's
  // content is unique, it embeds the minted id), values kept on a refusal.
  const registerSubmitted =
    actionData?.intent === "register" && actionData.registration === undefined ? actionData : undefined;
  const registerKey = actionData?.registration?.content ?? "register-form";
  const registerUnavailable = (
    <>
      <Banner tone="denial">{NEW_APPLICATION_COPY.unavailable}</Banner>
      <ProjectField projects={[]} submitted={registerSubmitted} idPrefix={REGISTER_FIELD_PREFIX} />
    </>
  );
  const endpointSubmitted = actionData?.endpoint;
  const endpointCopy = NEW_APPLICATION_COPY.endpoint;
  const endpointUnavailable = (
    <>
      <Banner tone="denial">{endpointCopy.unavailable}</Banner>
      <GuidanceEndpointField state={undefined} submitted={endpointSubmitted} />
    </>
  );
  const currentStep = newApplicationStep(actionData);
  return (
    <div className="new-application-flow">
      <PageHeader title={NEW_APPLICATION_COPY.heading} description={flowDescription(role)} />
      <Status tone={actionData?.status?.tone ?? "notice"} message={actionData?.status?.message} />
      <ol className="flow-rail" aria-label="Application flow progress">
        {(["place", "boilerplate", "result"] as const).map((step, index) => (
          <li className="flow-step" key={step} aria-current={currentStep === step ? "step" : undefined}>
            <span className="flow-step__number" aria-hidden="true">{index + 1}</span>
            <span>
              {step === "place" ? "Place" : step === "boilerplate" ? "Generate" : "Result"}
            </span>
          </li>
        ))}
      </ol>
      <Tabs
        label="Application options"
        tabs={APPLICATION_TABS}
        value={activeTab}
        onChange={(id) => {
          setActiveTab(id as NewApplicationTab);
        }}
      />
      <section
        id="place-panel"
        className="new-application__panel"
        role="tabpanel"
        aria-labelledby="tab-place"
        tabIndex={0}
        hidden={activeTab !== "place"}
      >
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
      </section>
      <section
        id="generate-panel"
        className="new-application__panel"
        role="tabpanel"
        aria-labelledby="tab-generate"
        tabIndex={0}
        hidden={activeTab !== "generate"}
      >
        {actionData?.placedId === undefined ? (
          <EmptyState
            icon="application"
            title="Place an Application first"
            description="Place an Application on a Project to generate its Boilerplate."
          />
        ) : (
          <>
            <BoilerplateForm applicationId={actionData.placedId} />
            {actionData.boilerplate === undefined ? null : <BoilerplateResultSection result={actionData.boilerplate} />}
          </>
        )}
      </section>
      <section
        id="register-panel"
        className="new-application__panel"
        role="tabpanel"
        aria-labelledby="tab-register"
        tabIndex={0}
        hidden={activeTab !== "register"}
      >
        <RegisterApplicationForm key={registerKey} submitted={registerSubmitted}>
          <Suspense
            fallback={
              <ProjectField
                projects={[]}
                busy
                note={NEW_APPLICATION_COPY.loading}
                submitted={registerSubmitted}
                idPrefix={REGISTER_FIELD_PREFIX}
              />
            }
          >
            <Await resolve={tree} errorElement={registerUnavailable}>
              {(result: RegistryResult<ProjectTree>) =>
                result.kind === "ok" ? (
                  <ProjectField
                    projects={result.value.projects}
                    submitted={registerSubmitted}
                    idPrefix={REGISTER_FIELD_PREFIX}
                  />
                ) : (
                  registerUnavailable
                )
              }
            </Await>
          </Suspense>
        </RegisterApplicationForm>
        {actionData?.registration === undefined ? null : <RegistrationResultSection rendering={actionData.registration} />}
      </section>
      <SectionCard title="Company setup" action={<Badge tone="outline">Buyer</Badge>}>
        <GuidanceEndpointForm placedId={actionData?.placedId}>
          <Suspense
            fallback={
              <GuidanceEndpointField state={undefined} busy note={endpointCopy.loading} submitted={endpointSubmitted} />
            }
          >
            <Await resolve={endpoint} errorElement={endpointUnavailable}>
              {(result: RegistryResult<GuidanceEndpointState>) =>
                result.kind === "ok" ? (
                  <GuidanceEndpointField state={result.value} submitted={endpointSubmitted} />
                ) : (
                  endpointUnavailable
                )
              }
            </Await>
          </Suspense>
        </GuidanceEndpointForm>
      </SectionCard>
    </div>
  );
}
