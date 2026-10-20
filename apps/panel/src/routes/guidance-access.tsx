import { Suspense, useState } from "react";
import { Await, data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { GRANTABLE_ROLES, ROLE_DENIED, SESSION_INVALID } from "@domain-harness/contract";
import type { ErrorEnvelope, GrantableRole, GuidanceAccessState } from "@domain-harness/contract";
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { Button } from "../components/button.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SectionCard } from "../components/section-card.tsx";
import { Status } from "../components/status.tsx";
import { formatDateTime } from "../format.ts";
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
const ROLE_DESCRIPTIONS: Record<GrantableRole, string> = {
  "Standard owner": "Read Guidance events while managing Standards.",
  Builder: "Read Guidance events while working with Applications.",
};

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
      <PageHeader
        eyebrow="Access"
        title={GUIDANCE_ACCESS_COPY.heading}
        description="Manage which roles can read Guidance events and how long they are kept."
      />
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
  const unavailable = <Banner tone="notice">{copy.unavailable}</Banner>;
  return (
    <Suspense fallback={<SectionCard title={copy.heading}><p>{copy.loading}</p></SectionCard>}>
      <Await resolve={access} errorElement={unavailable}>
        {(result: RegistryResult<GuidanceAccessState>) =>
          result.kind === "ok" ? (
            <div className="guidance-layout">
              <GrantSection key={formKey} state={result.value} actionData={actionData} />
              <MintSection formKey={formKey} actionData={actionData} />
            </div>
          ) : result.kind === "refused" && result.error.code === SESSION_INVALID ? (
            <Banner tone="denial" title={copy.heading}>
              <p>{GUIDANCE_ACCESS_COPY.sessionEnded}</p>
              <p>
                <Link to="/sign-in">{GUIDANCE_ACCESS_COPY.signInAgain}</Link>
              </p>
            </Banner>
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
  readonly actionData: GuidanceAccessActionData | undefined;
}

/** The Buyer-only grant and retention form. */
function GrantSection({ state, actionData }: GrantSectionProps) {
  const copy = GUIDANCE_ACCESS_COPY;
  const baselineGrants = GRANTABLE_ROLES.filter((role) => state.grantedRoles.includes(role));
  const baselineRetention = String(state.retentionDays);
  const submitted =
    actionData?.intent === "save" && actionData.savedAt === undefined ? actionData.values : null;
  const initialGrants =
    submitted === null ? baselineGrants : GRANTABLE_ROLES.filter((role) => submitted.grants.includes(role));
  const initialRetention = submitted === null ? baselineRetention : submitted.retentionDays;
  const [grants, setGrants] = useState<readonly GrantableRole[]>(initialGrants);
  const [retentionDays, setRetentionDays] = useState(initialRetention);
  const grantsChanged = GRANTABLE_ROLES.some((role) => grants.includes(role) !== baselineGrants.includes(role));
  const hasChanges = grantsChanged || retentionDays !== baselineRetention;

  function discardChanges() {
    setGrants(baselineGrants);
    setRetentionDays(baselineRetention);
  }

  return (
    <Form method="post" aria-label={copy.grant.heading} className="guidance-settings" data-dirty={hasChanges}>
      <input type="hidden" name="intent" value="save" />
      <SectionCard title={copy.grant.heading}>
        {state.grantedRoles.length === 0 && state.updatedAt === null ? (
          <EmptyState
            icon="guidance"
            title="No Guidance access grant is configured."
            description={`Guidance events are kept for ${String(state.retentionDays)} days by default.`}
          />
        ) : null}
        <fieldset className="guidance-role-list">
          <legend className="visually-hidden">Role access</legend>
          <RoleRow
            role="Buyer"
            checked
            disabled
            badge="Always granted"
            description={copy.grant.buyerAlways}
          />
          {GRANTABLE_ROLES.map((role) => (
            <RoleRow
              key={role}
              role={role}
              checked={grants.includes(role)}
              badge={grants.includes(role) ? "Granted" : "Not granted"}
              description={ROLE_DESCRIPTIONS[role]}
              onChange={(checked) => {
                setGrants((current) =>
                  checked
                    ? GRANTABLE_ROLES.filter((candidate) => current.includes(candidate) || candidate === role)
                    : current.filter((candidate) => candidate !== role),
                );
              }}
            />
          ))}
        </fieldset>
      </SectionCard>

      <div className="retention-card">
        <SectionCard title={copy.retention.heading}>
          <p className="retention-current">{copy.retention.current(state.retentionDays)}</p>
          <label className="retention-control">
            <span>{copy.retention.label}</span>
            <input
              type="number"
              name="retentionDays"
              value={retentionDays}
              min={1}
              max={3650}
              aria-invalid={actionData?.fieldErrors.retentionDays !== undefined}
              aria-describedby={
                actionData?.fieldErrors.retentionDays !== undefined ? "retention-error" : "retention-help"
              }
              onChange={(event) => {
                setRetentionDays(event.currentTarget.value);
              }}
            />
          </label>
          {actionData?.fieldErrors.retentionDays !== undefined ? (
          <p className="retention-error" id="retention-error">
            {actionData.fieldErrors.retentionDays}
          </p>
        ) : (
          <p className="retention-help" id="retention-help">
            Choose a whole number of days from 1 to 3650.
          </p>
          )}
        </SectionCard>
      </div>

      {hasChanges ? (
        <div className="save-bar" role="group" aria-label="Unsaved Guidance access changes">
          <Button variant="primary" type="submit">
            {copy.grant.save}
          </Button>
          <Button variant="ghost" type="button" onClick={discardChanges}>
            Discard
          </Button>
        </div>
      ) : null}
    </Form>
  );
}

function RoleRow({
  role,
  checked,
  disabled = false,
  badge,
  description,
  onChange,
}: {
  readonly role: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly badge: string;
  readonly description: string;
  readonly onChange?: (checked: boolean) => void;
}) {
  const id = `guidance-role-${role.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <div className="role-row">
      <label className="role-row__control" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          name="grants"
          value={role}
          checked={checked}
          disabled={disabled}
          readOnly={disabled}
          aria-describedby={`${id}-description`}
          onChange={(event) => { onChange?.(event.currentTarget.checked); }}
        />
        <span className="role-row__name">{role}</span>
      </label>
      <Badge tone={disabled ? "solid" : checked ? "outline" : "neutral"} icon={checked ? "check" : "dash"}>
        {badge}
      </Badge>
      <p className="role-row__description" id={`${id}-description`}>
        {description}
      </p>
    </div>
  );
}

/** The viewer's own read-token mint: the token text is shown once, never stored. */
function MintSection({ formKey, actionData }: { readonly formKey: string; readonly actionData: GuidanceAccessActionData | undefined }) {
  const copy = GUIDANCE_ACCESS_COPY;
  return (
    <SectionCard title={copy.token.heading}>
      <Form key={`mint-${formKey}`} method="post" aria-label={copy.token.heading}>
        <input type="hidden" name="intent" value="mint" />
        <Button variant="primary" type="submit">
          {copy.token.mint}
        </Button>
      </Form>
      {actionData?.intent === "mint" && actionData.token !== undefined && (
        <div className="token-block">
          <p className="token-block__instructions">Use this token inside the Company network</p>
          <div className="token-block__value">
            <pre>
              <output role="group" aria-label="One-time read token">
                <code>{actionData.token.token}</code>
              </output>
            </pre>
            <CopyButton value={actionData.token.token} />
          </div>
          <p className="token-block__expiry">
            <time dateTime={actionData.token.expiresAt}>
              Expires {formatDateTime(actionData.token.expiresAt)}
            </time>
          </p>
        </div>
      )}
    </SectionCard>
  );
}
