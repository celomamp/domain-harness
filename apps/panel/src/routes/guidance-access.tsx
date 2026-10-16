import { Suspense } from "react";
import { Await, data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { GRANTABLE_ROLES, ROLE_DENIED, SESSION_INVALID } from "@domain-harness/contract";
import type { ErrorEnvelope, GrantableRole, GuidanceAccessState } from "@domain-harness/contract";
import { Button } from "../components/button.tsx";
import { Status } from "../components/status.tsx";
import { getGuidanceAccess, mintRoleToken, setGuidanceAccess } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Guidance access | Domain Harness" }];

export const GUIDANCE_ACCESS_COPY = {
  heading: "Guidance access",
  grant: {
    heading: "Who can read Guidance events",
    loading: "Loading the grant…",
    unavailable: "The grant is unavailable right now. Try again in a few minutes.",
    buyerAlways: "Buyer: always granted.",
    granted: (role: string) => `${role}: granted.`,
    denied: (role: string) => `${role}: not granted.`,
    save: "Save Guidance access",
    saved: "Saved the Guidance access.",
    denial: "Only the Buyer can configure Guidance access. Nothing was saved.",
  },
  retention: {
    heading: "Retention",
    label: "Keep Guidance events for (days)",
    current: (days: number) => `Currently keeping Guidance events for ${String(days)} days.`,
    invalid: "Retention must be a whole number of days from 1 to 3650.",
  },
  token: {
    heading: "Your read token",
    loading: "",
    mint: "Mint a read token for my role",
    minted: "Use this token inside the Company network to read Guidance events. Copy it now: it is shown once.",
    denial: "Your role holds no grant to read Guidance events, so no token was minted.",
  },
  actionUnavailable: "The surface is unavailable right now, so nothing was saved. Try again in a few minutes.",
  sessionEnded: "Your session has ended, so the surface cannot be shown.",
  signInAgain: "Sign in again",
} as const;

export interface GuidanceAccessLoaderData {
  /** The tenant's access state, not awaited: the structure shows first while it loads. */
  readonly access: Promise<RegistryResult<GuidanceAccessState>>;
}

/** Every role may read the Guidance access surface. Without a session cookie the page goes to sign-in. */
export function loader({ request }: LoaderFunctionArgs): Response | GuidanceAccessLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { access: getGuidanceAccess(token) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** What the save and mint actions report back to the page. */
export interface GuidanceAccessActionData {
  /** The submitted form or `""` when none of the surface's intents matched. */
  readonly intent: "save" | "mint" | "";
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Field errors, shown in place; the submitted values are kept. */
  readonly fieldErrors: { readonly retentionDays?: string };
  /** The submitted values, kept on refusal. */
  readonly values: { readonly grants: readonly string[]; readonly retentionDays: string };
  /** The minted token, shown once on a mint success. */
  readonly token?: { readonly token: string; readonly role: string; readonly expiresAt: string };
  /** A success remounts the forms; the key is the saved instant. */
  readonly savedAt?: string;
}

const emptyValues = { grants: [], retentionDays: "" } as const;

/**
 * The page's two intents: `save` sends the grant plus the retention days to
 * the registry (the registry allows only the Buyer, so any other role's
 * submit is a denial), and `mint` mints one role token for the viewer's own
 * role (the registry refuses ungranted roles). A success remounts the forms;
 * a refusal keeps the page with its values.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "save") {
    const grants = form.getAll("grants").filter((entry): entry is string => typeof entry === "string");
    const retentionDays = field(form, "retentionDays").trim();
    const values = { grants, retentionDays };
    const days = Number(retentionDays);
    if (retentionDays === "" || !Number.isInteger(days)) {
      return data<GuidanceAccessActionData>(
        {
          intent,
          status: null,
          fieldErrors: { retentionDays: GUIDANCE_ACCESS_COPY.retention.invalid },
          values,
        },
        { status: 400 },
      );
    }
    const grantRecord = Object.fromEntries(GRANTABLE_ROLES.map((role) => [role, grants.includes(role)])) as Record<
      GrantableRole,
      boolean
    >;
    const result = await setGuidanceAccess(token, grantRecord, days);
    if (result.kind === "ok") {
      return data<GuidanceAccessActionData>({
        intent,
        status: { tone: "notice", message: GUIDANCE_ACCESS_COPY.grant.saved },
        fieldErrors: {},
        values: { grants: [], retentionDays: "" },
        savedAt: result.value.updatedAt ?? new Date().toISOString(),
      });
    }
    return refusal(intent, values, result.kind === "refused" ? result.error : undefined);
  }
  if (intent === "mint") {
    const result = await mintRoleToken(token);
    if (result.kind === "ok") {
      return data<GuidanceAccessActionData>({
        intent,
        status: { tone: "notice", message: GUIDANCE_ACCESS_COPY.token.minted },
        fieldErrors: {},
        values: emptyValues,
        token: { token: result.value.token, role: result.value.role, expiresAt: result.value.expiresAt },
        savedAt: result.value.expiresAt,
      });
    }
    return refusal(intent, emptyValues, result.kind === "refused" ? result.error : undefined);
  }
  return data<GuidanceAccessActionData>(
    { intent: "", status: { tone: "denial", message: GUIDANCE_ACCESS_COPY.actionUnavailable }, fieldErrors: {}, values: emptyValues },
    { status: 400 },
  );
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
function refusal(
  intent: "save" | "mint",
  values: { readonly grants: readonly string[]; readonly retentionDays: string },
  error: ErrorEnvelope | undefined,
) {
  const denial = (status: number, message: string) =>
    data<GuidanceAccessActionData>({ intent, status: { tone: "denial", message }, fieldErrors: {}, values }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return denial(403, intent === "save" ? GUIDANCE_ACCESS_COPY.grant.denial : GUIDANCE_ACCESS_COPY.token.denial);
    default:
      break;
  }
  if (intent === "save" && error?.code === "invalid_input" && error.subject === "retentionDays") {
    return data<GuidanceAccessActionData>(
      { intent, status: null, fieldErrors: { retentionDays: GUIDANCE_ACCESS_COPY.retention.invalid }, values },
      { status: 400 },
    );
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, GUIDANCE_ACCESS_COPY.actionUnavailable);
}

/**
 * The Guidance access surface: the grant per role, the retention setting,
 * and the viewer's read-token mint. The surface configures the grant and
 * shows the retention value; it never renders Guidance-event content.
 */
export default function GuidanceAccess() {
  const { access } = useLoaderData<GuidanceAccessLoaderData>();
  const actionData = useActionData<GuidanceAccessActionData>();
  return (
    <>
      <h1 className="type-title">{GUIDANCE_ACCESS_COPY.heading}</h1>
      <Status tone={actionData?.status?.tone ?? "notice"} message={actionData?.status?.message} />
      <AccessState access={access} formKey={actionData?.savedAt ?? "form"} actionData={actionData} />
    </>
  );
}

interface AccessStateProps {
  readonly access: Promise<RegistryResult<GuidanceAccessState>>;
  /** A success remounts the forms; the key is the saved instant. */
  readonly formKey: string;
  readonly actionData: GuidanceAccessActionData | undefined;
}

/** The access state under its own Suspense, with the save and mint commits beside it. */
function AccessState({ access, formKey, actionData }: AccessStateProps) {
  const copy = GUIDANCE_ACCESS_COPY.grant;
  const unavailable = (
    <section aria-label={copy.heading}>
      <h2 className="type-title-sm">{copy.heading}</h2>
      <p>{copy.unavailable}</p>
    </section>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={copy.heading} aria-busy="true">
          <h2 className="type-title-sm">{copy.heading}</h2>
          <p>{copy.loading}</p>
        </section>
      }
    >
      <Await resolve={access} errorElement={unavailable}>
        {(result: RegistryResult<GuidanceAccessState>) =>
          result.kind === "ok" ? (
            <>
              <GrantSection state={result.value} formKey={formKey} actionData={actionData} />
              <MintSection formKey={formKey} actionData={actionData} />
            </>
          ) : result.kind === "refused" && result.error.code === SESSION_INVALID ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              <p>{GUIDANCE_ACCESS_COPY.sessionEnded}</p>
              <p>
                <Link to="/sign-in">{GUIDANCE_ACCESS_COPY.signInAgain}</Link>
              </p>
            </section>
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

interface GrantSectionProps {
  readonly state: GuidanceAccessState;
  readonly formKey: string;
  readonly actionData: GuidanceAccessActionData | undefined;
}

/** The grant checkboxes per grantable role plus the retention input, Buyer-only on save. */
function GrantSection({ state, formKey, actionData }: GrantSectionProps) {
  const copy = GUIDANCE_ACCESS_COPY;
  const submitted = actionData?.intent === "save" ? actionData.values : null;
  const checked = (role: GrantableRole): boolean =>
    submitted !== null ? submitted.grants.includes(role) : state.grantedRoles.includes(role);
  const retentionDefault = submitted !== null ? submitted.retentionDays : String(state.retentionDays);
  return (
    <section aria-label={copy.grant.heading}>
      <h2 className="type-title-sm">{copy.grant.heading}</h2>
      <p>{copy.grant.buyerAlways}</p>
      <ul>
        {GRANTABLE_ROLES.map((role) => (
          <li key={role}>{state.grantedRoles.includes(role) ? copy.grant.granted(role) : copy.grant.denied(role)}</li>
        ))}
      </ul>
      <Form key={formKey} method="post" aria-label={copy.grant.heading}>
        <input type="hidden" name="intent" value="save" />
        <fieldset>
          <legend>{copy.grant.heading}</legend>
          {GRANTABLE_ROLES.map((role) => (
            <label key={role}>
              <input type="checkbox" name="grants" value={role} defaultChecked={checked(role)} />
              {role}
            </label>
          ))}
        </fieldset>
        <p>{copy.retention.current(state.retentionDays)}</p>
        <label>
          {copy.retention.label}
          <input type="number" name="retentionDays" defaultValue={retentionDefault} min={1} max={3650} />
        </label>
        {actionData?.fieldErrors.retentionDays !== undefined && <p role="alert">{actionData.fieldErrors.retentionDays}</p>}
        <Button variant="primary" type="submit">
          {copy.grant.save}
        </Button>
      </Form>
    </section>
  );
}

/** The viewer's own read-token mint: the token text is shown once, never stored. */
function MintSection({ formKey, actionData }: { readonly formKey: string; readonly actionData: GuidanceAccessActionData | undefined }) {
  const copy = GUIDANCE_ACCESS_COPY;
  return (
    <section aria-label={copy.token.heading}>
      <h2 className="type-title-sm">{copy.token.heading}</h2>
      <Form key={`mint-${formKey}`} method="post" aria-label={copy.token.heading}>
        <input type="hidden" name="intent" value="mint" />
        <Button variant="primary" type="submit">
          {copy.token.mint}
        </Button>
      </Form>
      {actionData?.intent === "mint" && actionData.token !== undefined && (
        <output>{actionData.token.token}</output>
      )}
    </section>
  );
}
