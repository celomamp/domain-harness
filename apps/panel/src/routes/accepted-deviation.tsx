import { Suspense, useEffect, useState } from "react";
import { Await, Link, data, Form, redirect, useActionData, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  APPLICATION_NOT_FOUND,
  MODULE_KINDS,
  PLAN_REFUSED,
  SESSION_INVALID,
  isUtcIso,
  parseDeviationLine,
} from "@domain-harness/contract";
import type {
  AcceptedDeviationRecord,
  ApplicationInfo,
  EffectiveStandard,
  EffectiveStandardSet,
  ErrorEnvelope,
} from "@domain-harness/contract";
import { PlanRefusal } from "../components/project-tree.tsx";
import { Button } from "../components/button.tsx";
import { Status } from "../components/status.tsx";
import { getAcceptedDeviations, getApplications, getEffectiveStandards, recordAcceptance } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Accepted deviation | Domain Harness" }];

/** The fields of the acceptance form, each with its field-error ink. */
export type AcceptedDeviationField =
  | "applicationId"
  | "standardId"
  | "slot"
  | "subject"
  | "justification"
  | "start"
  | "end"
  | "alertIntervalHours";

export const ACCEPTED_DEVIATION_COPY = {
  heading: "Accepted deviation",
  loading: "Loading the Applications…",
  unavailable: "The Company's data is unavailable right now. Try again in a few minutes.",
  actionUnavailable: "The surface is unavailable right now, so nothing was recorded. Try again in a few minutes.",
  sessionEnded: "Your session has ended, so the surface cannot be shown.",
  signInAgain: "Sign in again",
  submit: "Record Accepted deviation",
  storedNote: "Stored: Buyer, justification, start, end, match key.",
  records: {
    heading: "Stored Accepted deviations",
    loading: "Loading the stored Accepted deviations…",
    unavailable: "The stored Accepted deviations are unavailable right now. Try again in a few minutes.",
    empty: "No Accepted deviation is recorded yet.",
    line: (record: AcceptedDeviationRecord) =>
      `${record.subject}, Standard version ${String(record.standardVersion)}, slot (${record.slot.moduleKind}, ${
        record.slot.slotKind
      }, "${record.slot.name}") on Application ${record.applicationId}: by ${record.buyer.name}, recorded ${
        record.createdAt.slice(0, 10)
      }, from ${record.start.slice(0, 10)} to ${record.end.slice(0, 10)}, alert every ${String(
        record.alertIntervalHours,
      )} hours. ${record.justification}`,
  },
  paste: {
    label: "CI Gate deviation log line",
    hint: "Paste the Gate's Deviation line to fill the match key.",
    use: "Use this line",
    error: "That line is not a Gate Deviation line. Nothing is filled; enter the match key by hand.",
  },
  labels: {
    applicationId: "Application",
    standardId: "Standard id",
    slot: "Conflict slot",
    subject: "Subject",
    justification: "Justification",
    start: "Start",
    end: "End",
    alertIntervalHours: "Alert interval (hours)",
  } satisfies Record<AcceptedDeviationField, string>,
  fieldErrors: {
    applicationId: "Choose an Application of this Company.",
    standardId: "Enter the Standard id exactly as the Deviation names it.",
    slot: "Write the Conflict slot as moduleKind/slotKind/name, for example code-stack/library/React.",
    subject: "Enter the subject exactly as the Deviation names it.",
    justification: "Enter a justification of 1 or more characters. Nothing was recorded.",
    start: "Enter the start date.",
    end: "An end before the start is not recorded. The record is unwritten.",
    alertIntervalHours: "Enter an integer from 1 to 8760 hours. Nothing was recorded.",
  } satisfies Record<AcceptedDeviationField, string>,
  chooseApplication: "Choose an Application",
  resolved: (version: number) => `Resolved Standard version ${String(version)} in the Application's Effective Standard set.`,
  noMatch: "No matching Standard in this Application's Effective Standard set.",
  resolvedLoading: "Resolving the Standard version…",
  builderDenial: "A Builder cannot accept their own Deviation. The Buyer records the acceptance.",
  planRefusal: "Recording an Accepted deviation is included in Team (first sale). Nothing was changed.",
  applicationNotFound: "That Application was not found. Nothing was recorded.",
  recorded: (subject: string) => `Recorded the Accepted deviation for ${subject}.`,
  back: "Back to Application evidence",
} as const;

/** What the record action reports back to the page. */
export interface AcceptedDeviationActionData {
  /** The submitted form or `""` when none of the surface's intents matched. */
  readonly intent: "record" | "";
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field of the submitted form. */
  readonly fieldErrors: Readonly<Partial<Record<AcceptedDeviationField, string>>>;
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: Readonly<Partial<Record<AcceptedDeviationField, string>>>;
  /** A plan refusal, shown in place inside the submitted form (the top status stays empty). */
  readonly planRefusal?: string;
  /** The id of the acceptance just recorded (the form remounts empty on a success). */
  readonly recordedId?: string;
}

export interface AcceptedDeviationLoaderData {
  /** The Company's Applications, not awaited: the form structure streams first. */
  readonly applications: Promise<RegistryResult<readonly ApplicationInfo[]>>;
  /**
   * The chosen Application's Effective Standard set, not awaited: chained off
   * the Applications so it resolves the same selection (`?application=` when
   * it is in the list). The resolved Standard version for the typed match key
   * is read from it; the panel never submits a version. `null` when no
   * Application is selected (the resolved area shows nothing) — distinct
   * from a registry outage, which is an `unavailable` result.
   */
  readonly effective: Promise<RegistryResult<EffectiveStandardSet> | null>;
  /** The stored Accepted deviations, newest first, not awaited either. */
  readonly records: Promise<RegistryResult<AcceptedDeviationRecord[]>>;
}

const PAGE = "/accepted-deviation";

/** The chosen Application: `?application=` when it is the list, otherwise `null`. */
export function selectedApplication(applications: readonly ApplicationInfo[], param: string | null): ApplicationInfo | null {
  return param === null ? null : (applications.find((application) => application.id === param) ?? null);
}

/**
 * The Accepted-deviation surface. Every role may read. Without a session
 * cookie the page goes to sign-in; otherwise the Applications, the chosen
 * Application's Effective Standard set and the stored deviations stream in.
 * A Community tenant sees its plan refusal through the same streams.
 */
export function loader({ request }: LoaderFunctionArgs): Response | AcceptedDeviationLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const applicationParam = new URL(request.url).searchParams.get("application");
  const applications = getApplications(token).then((result) =>
    result.kind === "ok" ? { kind: "ok" as const, value: result.value.applications } : result,
  );
  // The loader's `effective` is `null` when no Application is selected: a
  // surface-state distinct from an outage, which is an `unavailable` result.
  const effective = applications.then(
    (result): RegistryResult<EffectiveStandardSet> | null | Promise<RegistryResult<EffectiveStandardSet>> => {
      const selected = result.kind === "ok" ? selectedApplication(result.value, applicationParam) : null;
      return selected === null ? null : getEffectiveStandards(token, selected.project.id);
    },
  );
  return { applications, effective, records: getAcceptedDeviations(token) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** True when a streamed result is the tenant's plan refusal (a Community tenant's read). */
const isPlanRefusal = (result: RegistryResult<unknown>): boolean =>
  result.kind === "refused" && result.error.code === PLAN_REFUSED;

/** `YYYY-MM-DD` from a date input becomes the full UTC instant they reach the registry as. */
export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
}

/**
 * `moduleKind/slotKind/name`, split the way the contract's
 * `parseDeviationLine` splits the Gate's slot token: the Module kind and the
 * slot kind are the first two `/`-separated parts and the slot name is the
 * remainder (so a slot name carrying its own `/`, like an import specifier,
 * round-trips). `null` when the text is not exactly that.
 */
export function parseSlot(value: string): { moduleKind: string; slotKind: string; name: string } | null {
  const parts = value.trim().split("/");
  const moduleKind = parts[0] ?? "";
  const slotKind = parts[1] ?? "";
  const name = parts.slice(2).join("/");
  if (
    parts.length < 3 ||
    moduleKind === "" ||
    slotKind === "" ||
    name === "" ||
    !MODULE_KINDS.includes(moduleKind as (typeof MODULE_KINDS)[number])
  ) {
    return null;
  }
  return { moduleKind, slotKind, name };
}

/**
 * The page's one intent: `record` sends the match key and the window to the
 * registry as submitted (the registry resolves the Standard version itself,
 * checks the role before the plan and the plan before the body, so a
 * Builder's submit is a denial whatever it holds and a Community Buyer's is a
 * plan refusal). Values go back kept on every refusal.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  if (field(form, "intent") !== "record") {
    return data<AcceptedDeviationActionData>(
      { intent: "", status: { tone: "denial", message: ACCEPTED_DEVIATION_COPY.actionUnavailable }, fieldErrors: {}, values: {} },
      { status: 400 },
    );
  }
  const values: Partial<Record<AcceptedDeviationField, string>> = {
    applicationId: field(form, "applicationId"),
    standardId: field(form, "standardId"),
    slot: field(form, "slot"),
    subject: field(form, "subject"),
    justification: field(form, "justification"),
    start: field(form, "start"),
    end: field(form, "end"),
    alertIntervalHours: field(form, "alertIntervalHours"),
  };

  // Client-side field errors for what the registry would answer, so a
  // malformed key never leaves the page. Every check mirrors the registry's.
  const errors: Partial<Record<AcceptedDeviationField, string>> = {};
  const slot = parseSlot(values.slot ?? "");
  if (slot === null) errors["slot"] = ACCEPTED_DEVIATION_COPY.fieldErrors.slot;
  const interval = Number(values.alertIntervalHours ?? "");
  if (!Number.isInteger(interval) || interval < 1 || interval > 8760) {
    errors["alertIntervalHours"] = ACCEPTED_DEVIATION_COPY.fieldErrors.alertIntervalHours;
  }
  const start = normalizeDate(values.start ?? "");
  const end = normalizeDate(values.end ?? "");
  if (!isUtcIso(start)) errors["start"] = ACCEPTED_DEVIATION_COPY.fieldErrors.start;
  if (!isUtcIso(end)) errors["end"] = ACCEPTED_DEVIATION_COPY.fieldErrors.end;
  else if (Date.parse(end) <= Date.parse(start)) errors["end"] = ACCEPTED_DEVIATION_COPY.fieldErrors.end;
  if (values.justification?.trim() === "") errors["justification"] = ACCEPTED_DEVIATION_COPY.fieldErrors.justification;
  if (values.subject?.trim() === "") errors["subject"] = ACCEPTED_DEVIATION_COPY.fieldErrors.subject;
  if (values.standardId?.trim() === "") errors["standardId"] = ACCEPTED_DEVIATION_COPY.fieldErrors.standardId;
  if (values.applicationId === "") errors["applicationId"] = ACCEPTED_DEVIATION_COPY.fieldErrors.applicationId;
  if (Object.keys(errors).length > 0) {
    return data<AcceptedDeviationActionData>({ intent: "record", status: null, fieldErrors: errors, values }, { status: 400 });
  }

  // The early return above already handled a null slot.
  if (slot === null) {
    return data<AcceptedDeviationActionData>(
      { intent: "record", status: null, fieldErrors: { slot: ACCEPTED_DEVIATION_COPY.fieldErrors.slot }, values },
      { status: 400 },
    );
  }
  const result = await recordAcceptance(token, {
    applicationId: values["applicationId"] ?? "",
    standardId: values["standardId"] ?? "",
    slot,
    subject: values["subject"] ?? "",
    start,
    end,
    justification: values["justification"] ?? "",
    alertIntervalHours: interval,
  });
  if (result.kind === "ok") {
    return data<AcceptedDeviationActionData>({
      intent: "record",
      status: { tone: "notice", message: ACCEPTED_DEVIATION_COPY.recorded(result.value.subject) },
      fieldErrors: {},
      values: {},
      recordedId: result.value.id,
    });
  }
  return refusal(values, result.kind === "refused" ? result.error : undefined);
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
function refusal(values: AcceptedDeviationActionData["values"], error: ErrorEnvelope | undefined) {
  const denial = (status: number, message: string) =>
    data<AcceptedDeviationActionData>({ intent: "record", status: { tone: "denial", message }, fieldErrors: {}, values }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case "role_denied":
      return denial(403, ACCEPTED_DEVIATION_COPY.builderDenial);
    case "plan_refused":
      // In place inside the submitted form; the top status stays empty and the
      // submitted values are kept. The copy names Team (first sale), never a price.
      return data<AcceptedDeviationActionData>(
        { intent: "record", status: null, fieldErrors: {}, values, planRefusal: ACCEPTED_DEVIATION_COPY.planRefusal },
        { status: 403 },
      );
    case APPLICATION_NOT_FOUND:
      return denial(404, ACCEPTED_DEVIATION_COPY.applicationNotFound);
    case "invalid_input": {
      const subject = (Object.keys(ACCEPTED_DEVIATION_COPY.fieldErrors) as AcceptedDeviationField[]).find(
        (name) => name === error.subject,
      );
      if (subject !== undefined) {
        return data<AcceptedDeviationActionData>(
          { intent: "record", status: null, fieldErrors: { [subject]: ACCEPTED_DEVIATION_COPY.fieldErrors[subject] }, values },
          { status: 400 },
        );
      }
      break;
    }
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, ACCEPTED_DEVIATION_COPY.actionUnavailable);
}

/** The Accepted-deviation surface: the stored records, then the acceptance form. */
export default function AcceptedDeviationPage() {
  const { applications, effective, records } = useLoaderData<AcceptedDeviationLoaderData>();
  const actionData = useActionData<AcceptedDeviationActionData>();
  // A success remounts the form empty; a refusal keeps the submitted values.
  const formKey = actionData?.recordedId === undefined ? "form" : `recorded:${actionData.recordedId}`;
  return (
    <>
      <h1 className="type-title">{ACCEPTED_DEVIATION_COPY.heading}</h1>
      <Status tone={actionData?.status?.tone ?? "notice"} message={actionData?.status?.message} />
      <StoredRecords records={records} />
      <AcceptanceForm key={formKey} applications={applications} effective={effective} submitted={actionData?.recordedId !== undefined ? undefined : actionData} />
    </>
  );
}

/** The stored Accepted deviations under their own Suspense (every stored field visible). */
function StoredRecords({ records }: { readonly records: Promise<RegistryResult<AcceptedDeviationRecord[]>> }) {
  const copy = ACCEPTED_DEVIATION_COPY.records;
  return (
    <Suspense
      fallback={
        <section className="stored-records" aria-labelledby="stored-records-heading" aria-busy="true">
          <h2 id="stored-records-heading" className="type-title-sm">
            {copy.heading}
          </h2>
          <p>{copy.loading}</p>
        </section>
      }
    >
      <Await
        resolve={records}
        errorElement={
          <section className="stored-records" aria-labelledby="stored-records-heading">
            <h2 id="stored-records-heading" className="type-title-sm">
              {copy.heading}
            </h2>
            <p>{copy.unavailable}</p>
          </section>
        }
      >
        {(result: RegistryResult<AcceptedDeviationRecord[]>) =>
          result.kind === "ok" ? (
            <section className="stored-records" aria-labelledby="stored-records-heading">
              <h2 id="stored-records-heading" className="type-title-sm">
                {copy.heading}
              </h2>
              {result.value.length === 0 ? (
                <p>{copy.empty}</p>
              ) : (
                <ul className="stored-records__list">
                  {result.value.map((record) => (
                    <li key={record.id}>{copy.line(record)}</li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="stored-records" aria-labelledby="stored-records-heading">
              <h2 id="stored-records-heading" className="type-title-sm">
                {copy.heading}
              </h2>
              {isPlanRefusal(result) ? (
                // A Community tenant's cold load: the plan refusal shows when
                // the surface opens, not an outage.
                <PlanRefusal message={ACCEPTED_DEVIATION_COPY.planRefusal} />
              ) : (
                <p>{copy.unavailable}</p>
              )}
            </section>
          )
        }
      </Await>
    </Suspense>
  )
}

interface AcceptanceFormProps {
  /** The Applications: the list once it loads, or the busy or unavailable form. */
  readonly applications: Promise<RegistryResult<readonly ApplicationInfo[]>>;
  /** The chosen Application's Effective Standard set, for the resolved version; `null` when none is selected. */
  readonly effective: Promise<RegistryResult<EffectiveStandardSet> | null>;
  /** A refused submit: its values, field errors and in-place plan refusal, kept. */
  readonly submitted: AcceptedDeviationActionData | undefined;
}

/**
 * The acceptance form (the standard-form pattern). The paste area fills the
 * match key client-side only: a line the contract's parser rejects leaves the
 * fields untouched and shows the paste ink, and nothing is ever sent from it.
 * The resolved Standard version comes from the chosen Application's Effective
 * Standard set; the panel submits no version.
 */
function AcceptanceForm({ applications, effective, submitted }: AcceptanceFormProps) {
  const errors = submitted?.fieldErrors ?? {};
  const values = submitted?.values ?? {};
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // A Deviation row of the Application surface links here with the match key
  // in the query; a refused submit keeps its own values instead.
  const prefill = (name: AcceptedDeviationField): string => values[name] ?? searchParams.get(name) ?? "";
  // `returnTo` carries the Application row the Buyer came from (with its row
  // anchor): the back link and Esc both go there, returning focus to the row.
  const returnTo = searchParams.get("returnTo");
  useEffect(() => {
    if (returnTo === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void navigate(returnTo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [returnTo, navigate]);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState(false);
  // The match key, kept in state so the paste can pre-fill it and a refusal
  // can keep it (the submitted values — or the row's query prefill — seed the
  // state once, on mount).
  const [standardId, setStandardId] = useState(prefill("standardId"));
  const [slot, setSlot] = useState(prefill("slot"));
  const [subject, setSubject] = useState(prefill("subject"));
  // The Application travels as `?application=` (the loader's selection key);
  // the form field itself is `applicationId`.
  const applicationValue = values.applicationId ?? searchParams.get("application") ?? "";

  const useLine = () => {
    const key = parseDeviationLine(paste);
    if (key === null) {
      setPasteError(true);
      return;
    }
    setPasteError(false);
    setStandardId(key.standardId);
    setSlot(`${key.slot.moduleKind}/${key.slot.slotKind}/${key.slot.name}`);
    setSubject(key.subject);
  };

  return (
    <Form method="post" className="acceptance-form standard-form" aria-label={ACCEPTED_DEVIATION_COPY.heading} noValidate>
      <input type="hidden" name="intent" value="record" />
      {returnTo === null ? null : <Link to={returnTo}>{ACCEPTED_DEVIATION_COPY.back}</Link>}
      <div className="standard-form__fields" aria-busy={false}>
        <label htmlFor="accepted-deviation-ci-line" className="type-label">
          {ACCEPTED_DEVIATION_COPY.paste.label}
        </label>
        <textarea
          id="accepted-deviation-ci-line"
          rows={2}
          value={paste}
          onChange={(event) => {
            setPaste(event.target.value);
            setPasteError(false);
          }}
        />
        <p>{ACCEPTED_DEVIATION_COPY.paste.hint}</p>
        {pasteError ? (
          <p id="accepted-deviation-ci-line-error" className="field-error">
            {ACCEPTED_DEVIATION_COPY.paste.error}
          </p>
        ) : null}
        <Button variant="inverse" type="button" onClick={useLine}>
          {ACCEPTED_DEVIATION_COPY.paste.use}
        </Button>
      </div>
      <Suspense
        fallback={
          <div className="standard-form__fields">
            <label htmlFor="accepted-deviation-applicationId" className="type-label">
              {ACCEPTED_DEVIATION_COPY.labels.applicationId}
            </label>
            <select id="accepted-deviation-applicationId" name="applicationId" defaultValue="" aria-busy="true">
              <option value="">{ACCEPTED_DEVIATION_COPY.chooseApplication}</option>
            </select>
          </div>
        }
      >
        <Await
          resolve={applications}
          errorElement={
            <div className="standard-form__fields">
              <label htmlFor="accepted-deviation-applicationId" className="type-label">
                {ACCEPTED_DEVIATION_COPY.labels.applicationId}
              </label>
              <select id="accepted-deviation-applicationId" name="applicationId" defaultValue="" disabled>
                <option value="">{ACCEPTED_DEVIATION_COPY.unavailable}</option>
              </select>
            </div>
          }
        >
          {(result: RegistryResult<readonly ApplicationInfo[]>) =>
            result.kind === "ok" ? (
              <div className="standard-form__fields">
                <label htmlFor="accepted-deviation-applicationId" className="type-label">
                  {ACCEPTED_DEVIATION_COPY.labels.applicationId}
                </label>
                <select
                  id="accepted-deviation-applicationId"
                  name="applicationId"
                  defaultValue={applicationValue}
                  aria-invalid={errors["applicationId"] === undefined ? undefined : true}
                  aria-describedby={errors["applicationId"] === undefined ? undefined : "accepted-deviation-applicationId-error"}
                  onChange={(event) => {
                    const applicationId = event.target.value;
                    void navigate(
                      applicationId === "" ? PAGE : `${PAGE}?application=${encodeURIComponent(applicationId)}`,
                      { preventScrollReset: true },
                    );
                  }}
                >
                  <option value="">{ACCEPTED_DEVIATION_COPY.chooseApplication}</option>
                  {result.value.map((application) => (
                    <option key={application.id} value={application.id}>
                      {application.description} ({application.project.name})
                    </option>
                  ))}
                </select>
                {errors["applicationId"] === undefined ? null : (
                  <p id="accepted-deviation-applicationId-error" className="field-error">
                    {errors["applicationId"]}
                  </p>
                )}
              </div>
            ) : (
              <div className="standard-form__fields">
                <label htmlFor="accepted-deviation-applicationId" className="type-label">
                  {ACCEPTED_DEVIATION_COPY.labels.applicationId}
                </label>
                <select id="accepted-deviation-applicationId" name="applicationId" defaultValue="" disabled>
                  <option value="">{ACCEPTED_DEVIATION_COPY.unavailable}</option>
                </select>
              </div>
            )
          }
        </Await>
      </Suspense>
      <div className="standard-form__fields">
        <label htmlFor="accepted-deviation-standardId" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.standardId}
        </label>
        <input
          id="accepted-deviation-standardId"
          name="standardId"
          type="text"
          autoComplete="off"
          value={standardId}
          onChange={(event) => {
            setStandardId(event.target.value);
          }}
          aria-invalid={errors["standardId"] === undefined ? undefined : true}
          aria-describedby={errors["standardId"] === undefined ? undefined : "accepted-deviation-standardId-error"}
        />
        {errors["standardId"] === undefined ? null : (
          <p id="accepted-deviation-standardId-error" className="field-error">
            {errors["standardId"]}
          </p>
        )}
        <label htmlFor="accepted-deviation-slot" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.slot}
        </label>
        <input
          id="accepted-deviation-slot"
          name="slot"
          type="text"
          autoComplete="off"
          value={slot}
          onChange={(event) => {
            setSlot(event.target.value);
          }}
          aria-invalid={errors["slot"] === undefined ? undefined : true}
          aria-describedby={errors["slot"] === undefined ? undefined : "accepted-deviation-slot-error"}
        />
        {errors["slot"] === undefined ? null : (
          <p id="accepted-deviation-slot-error" className="field-error">
            {errors["slot"]}
          </p>
        )}
        <label htmlFor="accepted-deviation-subject" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.subject}
        </label>
        <input
          id="accepted-deviation-subject"
          name="subject"
          type="text"
          autoComplete="off"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
          }}
          aria-invalid={errors["subject"] === undefined ? undefined : true}
          aria-describedby={errors["subject"] === undefined ? undefined : "accepted-deviation-subject-error"}
        />
        {errors["subject"] === undefined ? null : (
          <p id="accepted-deviation-subject-error" className="field-error">
            {errors["subject"]}
          </p>
        )}
        <ResolvedVersion effective={effective} standardId={standardId} slotText={slot} />
      </div>
      <label htmlFor="accepted-deviation-justification" className="type-label">
        {ACCEPTED_DEVIATION_COPY.labels.justification}
      </label>
      <textarea
        id="accepted-deviation-justification"
        name="justification"
        rows={4}
        defaultValue={values.justification ?? ""}
        aria-invalid={errors["justification"] === undefined ? undefined : true}
        aria-describedby={errors["justification"] === undefined ? undefined : "accepted-deviation-justification-error"}
      />
      {errors["justification"] === undefined ? null : (
        <p id="accepted-deviation-justification-error" className="field-error">
          {errors["justification"]}
        </p>
      )}
      <div className="standard-form__fields">
        <label htmlFor="accepted-deviation-start" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.start}
        </label>
        <input
          id="accepted-deviation-start"
          name="start"
          type="date"
          defaultValue={values.start === undefined ? "" : values.start.slice(0, 10)}
          aria-invalid={errors["start"] === undefined ? undefined : true}
          aria-describedby={errors["start"] === undefined ? undefined : "accepted-deviation-start-error"}
        />
        {errors["start"] === undefined ? null : (
          <p id="accepted-deviation-start-error" className="field-error">
            {errors["start"]}
          </p>
        )}
        <label htmlFor="accepted-deviation-end" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.end}
        </label>
        <input
          id="accepted-deviation-end"
          name="end"
          type="date"
          defaultValue={values.end === undefined ? "" : values.end.slice(0, 10)}
          aria-invalid={errors["end"] === undefined ? undefined : true}
          aria-describedby={errors["end"] === undefined ? undefined : "accepted-deviation-end-error"}
        />
        {errors["end"] === undefined ? null : (
          <p id="accepted-deviation-end-error" className="field-error">
            {errors["end"]}
          </p>
        )}
        <label htmlFor="accepted-deviation-alertIntervalHours" className="type-label">
          {ACCEPTED_DEVIATION_COPY.labels.alertIntervalHours}
        </label>
        <input
          id="accepted-deviation-alertIntervalHours"
          name="alertIntervalHours"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={values.alertIntervalHours ?? ""}
          aria-invalid={errors["alertIntervalHours"] === undefined ? undefined : true}
          aria-describedby={
            errors["alertIntervalHours"] === undefined ? undefined : "accepted-deviation-alertIntervalHours-error"
          }
        />
        {errors["alertIntervalHours"] === undefined ? null : (
          <p id="accepted-deviation-alertIntervalHours-error" className="field-error">
            {errors["alertIntervalHours"]}
          </p>
        )}
      </div>
      <p>{ACCEPTED_DEVIATION_COPY.storedNote}</p>
      <Button variant="primary" type="submit">
        {ACCEPTED_DEVIATION_COPY.submit}
      </Button>
      <PlanRefusal message={submitted?.planRefusal} />
    </Form>
  )
}

/** The Conflict slot's name comparison, as the evaluator's slot rule normalizes it. */
const normalizedName = (name: string): string => name.trim().normalize("NFC").toLowerCase();

/** The Effective-set entry the typed match key resolves to, or `null` when none does. */
function resolvedEntry(
  set: EffectiveStandardSet,
  standardId: string,
  slotText: string,
): EffectiveStandard | null {
  const slot = parseSlot(slotText);
  if (slot === null || standardId.trim() === "") return null;
  return (
    set.standards.find(
      (entry) =>
        entry.standard.id === standardId.trim() &&
        entry.slot.moduleKind === slot.moduleKind &&
        entry.slot.slotKind === slot.slotKind &&
        normalizedName(entry.slot.name) === normalizedName(slot.name),
    ) ?? null
  );
}

/** The resolved Standard version of the typed key (guidance only; the registry decides). */
function ResolvedVersion({
  effective,
  standardId,
  slotText,
}: {
  readonly effective: Promise<RegistryResult<EffectiveStandardSet> | null>;
  readonly standardId: string;
  readonly slotText: string;
}) {
  return (
    <Suspense fallback={<p aria-busy="true">{ACCEPTED_DEVIATION_COPY.resolvedLoading}</p>}>
      <Await
        resolve={effective}
        errorElement={<p>{ACCEPTED_DEVIATION_COPY.unavailable}</p>}
      >
        {(result: RegistryResult<EffectiveStandardSet> | null) => {
          // No Application selected: the resolved area shows nothing (this is
          // not an outage).
          if (result === null) return null;
          if (result.kind === "refused" && isPlanRefusal(result)) {
            // A Community tenant's read streams its plan refusal in place.
            return <PlanRefusal message={ACCEPTED_DEVIATION_COPY.planRefusal} />;
          }
          if (result.kind !== "ok") return <p>{ACCEPTED_DEVIATION_COPY.unavailable}</p>;
          const entry = resolvedEntry(result.value, standardId, slotText);
          if (entry === null && (standardId.trim() === "" || slotText.trim() === "")) return null;
          return (
            <p>
              {entry === null ? ACCEPTED_DEVIATION_COPY.noMatch : ACCEPTED_DEVIATION_COPY.resolved(entry.standard.version)}
            </p>
          );
        }}
      </Await>
    </Suspense>
  );
}
