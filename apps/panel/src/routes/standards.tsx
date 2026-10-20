import { useEffect, useRef, useState } from "react";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  MODULE_NAME_TAKEN,
  MODULE_NOT_FOUND,
  ROLE_DENIED,
  SESSION_INVALID,
} from "@domain-harness/contract";
import type { ErrorEnvelope, ModuleList } from "@domain-harness/contract";
import { Button } from "../components/button.tsx";
import { CreateModuleSheet, MODULES_COPY, ModulesSection } from "../components/modules-section.tsx";
import type { ModulesActionData } from "../components/modules-section.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { assignModuleOwner, createModule, listModules } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Standards | Domain Harness" }];

/**
 * The Modules of the Company. The panel layout already guards the session;
 * a session that lapses in between is sent back to sign-in. Any other failure
 * leaves the structure in place with a status that Modules are unavailable.
 */
export async function loader({ request }: LoaderFunctionArgs): Promise<Response | { list: ModuleList | null }> {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const result = await listModules(token);
  if (result.kind === "ok") return { list: result.value };
  if (result.kind === "refused" && result.error.code === SESSION_INVALID) return redirect("/sign-in");
  return { list: null };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * `intent=create-module` (kind, name) or `intent=assign-owner` (moduleId,
 * accountId). Values go to the registry as submitted: it checks the role
 * first, then the input, so a Builder's submit is a denial whatever it holds.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  const intent = field(form, "intent");

  if (intent === "create-module") {
    const values = { kind: field(form, "kind"), name: field(form, "name") };
    const result = await createModule(token, values.kind, values.name);
    if (result.kind === "ok") {
      return data<ModulesActionData>({
        intent,
        status: { tone: "notice", message: MODULES_COPY.created(result.value.name) },
        fieldErrors: {},
        values: {},
        createdId: result.value.id,
      });
    }
    return refusal(intent, values, result.kind === "refused" ? result.error : undefined);
  }

  if (intent === "assign-owner") {
    const values = { moduleId: field(form, "moduleId"), accountId: field(form, "accountId") };
    const result = await assignModuleOwner(token, values.moduleId, values.accountId);
    if (result.kind === "ok") {
      const { name, owner } = result.value;
      return data<ModulesActionData>({
        intent,
        status: { tone: "notice", message: MODULES_COPY.assigned(owner?.name ?? "", name) },
        fieldErrors: {},
        values,
      });
    }
    return refusal(intent, values, result.kind === "refused" ? result.error : undefined);
  }

  return data<ModulesActionData>(
    { intent: null, status: { tone: "denial", message: MODULES_COPY.actionUnavailable }, fieldErrors: {}, values: {} },
    { status: 400 },
  );
}

/** Map a registry refusal (or an outage, `error` undefined) to what the section shows. */
function refusal(intent: "create-module" | "assign-owner", values: ModulesActionData["values"], error: ErrorEnvelope | undefined) {
  const reply = (status: number, rest: Pick<ModulesActionData, "status" | "fieldErrors">) =>
    data<ModulesActionData>({ intent, values, ...rest }, { status });
  const denial = (message: string) => ({ tone: "denial" as const, message });

  if (error?.code === SESSION_INVALID) return redirect("/sign-in");
  if (error?.code === ROLE_DENIED) return reply(403, { status: denial(MODULES_COPY.roleDenied), fieldErrors: {} });
  if (error?.code === MODULE_NOT_FOUND) return reply(404, { status: denial(MODULES_COPY.notFound), fieldErrors: {} });
  if (error?.code === MODULE_NAME_TAKEN) return reply(409, { status: null, fieldErrors: { name: MODULES_COPY.nameTaken } });
  if (error?.code === "invalid_input") {
    if (intent === "create-module" && error.subject === "kind") {
      return reply(400, { status: null, fieldErrors: { kind: MODULES_COPY.kindError } });
    }
    if (intent === "create-module" && error.subject === "name") {
      return reply(400, { status: null, fieldErrors: { name: MODULES_COPY.nameError } });
    }
    if (intent === "assign-owner" && error.subject === "accountId") {
      return reply(400, { status: null, fieldErrors: { accountId: MODULES_COPY.ownerError } });
    }
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return reply(503, { status: denial(MODULES_COPY.actionUnavailable), fieldErrors: {} });
}

/** Standards: the Modules of the Company; each Module name opens its Standards page. */
export default function Standards() {
  const { list } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [createOpen, setCreateOpen] = useState(false);
  const createData = actionData?.intent === "create-module" ? actionData : undefined;

  // A successful create closes the sheet; a refusal keeps it open with values.
  const previousAction = useRef<ModulesActionData | undefined>(undefined);
  useEffect(() => {
    if (actionData === previousAction.current) return;
    previousAction.current = actionData;
    if (createData?.createdId !== undefined) setCreateOpen(false);
  }, [actionData, createData]);

  return (
    <>
      <PageHeader
        eyebrow="Govern"
        title="Standards"
        description="Open a Module to see and publish its Standards."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            Create Module
          </Button>
        }
      />
      <ModulesSection list={list} actionData={actionData} />
      <CreateModuleSheet
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        submitted={createData}
      />
    </>
  );
}
