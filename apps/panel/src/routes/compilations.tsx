import { Suspense } from "react";
import { Await, data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { COMPILATION_CATALOG_VERSION, COMPILATION_SCHEMA_DOCS, ROLE_DENIED, SESSION_INVALID } from "@domain-harness/contract";
import type {
  BundleStatusView,
  CollectorHealthView,
  CompilationCatalogReadState,
  CompilationSchemaDoc,
  ErrorEnvelope,
} from "@domain-harness/contract";
import { Button } from "../components/button.tsx";
import { Status } from "../components/status.tsx";
import { getBundleStatus, getCatalogRead, getCollectorHealth, recordCatalogRead } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Compilations | Domain Harness" }];

export const COMPILATIONS_COPY = {
  heading: "Compilations",
  schemas: {
    heading: "Compilation schemas",
    version: (version: string) => `Schema version ${version}.`,
  },
  read: {
    heading: "Catalog read",
    loading: "Loading the read state…",
    unavailable: "The read state is unavailable right now. Try again in a few minutes.",
    read: (version: string, date: string) => `Read catalog ${version} on ${date}.`,
    unread: (version: string) =>
      `Not read yet. The Collector cannot send until the Buyer records reading catalog ${version}.`,
  },
  record: {
    submit: (version: string) => `I have read catalog ${version}`,
    recorded: (version: string) => `Recorded reading catalog ${version}.`,
    denial: "Only the Buyer can record reading the catalog. Nothing was recorded.",
  },
  status: {
    heading: "Bundle status",
    loading: "Loading the bundle status…",
    unavailable: "The bundle status is unavailable right now. Try again in a few minutes.",
    empty: "No bundle status yet. Nothing has arrived from the Collector.",
    age: (ageHours: number, boundHours: number) => `Age ${String(ageHours)}h of ${String(boundHours)}h bound.`,
    frozen: "frozen",
    unfrozen: "not frozen",
    stale: "stale",
  },
  health: {
    heading: "Collector health",
    loading: "Loading the Collector health…",
    unavailable: "The Collector health is unavailable right now. Try again in a few minutes.",
    empty: "No Collector health yet. Nothing has arrived from the Collector.",
    pending: (count: number) => `Pending ${String(count)}.`,
    dropped: (reason: string, count: number) => `Dropped ${reason}: ${String(count)}.`,
  },
  drops: {
    heading: "Compilation drops",
    empty: "No compilation drops reported.",
    unavailable: "The compilation drops are unavailable right now. Try again in a few minutes.",
  },
  actionUnavailable: "The surface is unavailable right now, so nothing was recorded. Try again in a few minutes.",
  sessionEnded: "Your session has ended, so the surface cannot be shown.",
  signInAgain: "Sign in again",
} as const;

export interface CompilationsLoaderData {
  /** The tenant's read state for the current catalog version, not awaited: the schemas show first while it loads. */
  readonly readState: Promise<RegistryResult<CompilationCatalogReadState>>;
  /** The tenant's bundle-status rows, not awaited: they stream beside the read state. */
  readonly bundleStatus: Promise<RegistryResult<BundleStatusView[]>>;
  /** The tenant's Collector-health rows, not awaited: they stream beside the read state. */
  readonly collectorHealth: Promise<RegistryResult<CollectorHealthView[]>>;
}

/** Every role may read the Compilations surface. Without a session cookie the page goes to sign-in. */
export function loader({ request }: LoaderFunctionArgs): Response | CompilationsLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { readState: getCatalogRead(token), bundleStatus: getBundleStatus(token), collectorHealth: getCollectorHealth(token) };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** What the record action reports back to the page. */
export interface CompilationsActionData {
  /** The submitted form or `""` when none of the surface's intents matched. */
  readonly intent: "record" | "";
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** The read instant just recorded (the form remounts on a success). */
  readonly recordedAt?: string;
}

/**
 * The page's one intent: `record` sends the current catalog version to the
 * registry as read (the registry allows only the Buyer, so any other role's
 * submit is a denial). A success remounts the form; a refusal keeps the page.
 */
export async function action({ request }: ActionFunctionArgs) {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  const form = await request.formData();
  if (field(form, "intent") !== "record") {
    return data<CompilationsActionData>(
      { intent: "", status: { tone: "denial", message: COMPILATIONS_COPY.actionUnavailable } },
      { status: 400 },
    );
  }
  const result = await recordCatalogRead(token, COMPILATION_CATALOG_VERSION);
  if (result.kind === "ok") {
    return data<CompilationsActionData>({
      intent: "record",
      status: { tone: "notice", message: COMPILATIONS_COPY.record.recorded(result.value.catalogVersion) },
      recordedAt: result.value.readAt,
    });
  }
  return refusal(result.kind === "refused" ? result.error : undefined);
}

/** Map a registry refusal (or an outage, `error` undefined) to what the page shows. */
function refusal(error: ErrorEnvelope | undefined) {
  const denial = (status: number, message: string) =>
    data<CompilationsActionData>({ intent: "record", status: { tone: "denial", message } }, { status });
  switch (error?.code) {
    case SESSION_INVALID:
      return redirect("/sign-in");
    case ROLE_DENIED:
      return denial(403, COMPILATIONS_COPY.record.denial);
    default:
      break;
  }
  // Any other refusal (a misrouted registry URL answering 404 or 415) or an outage.
  return denial(503, COMPILATIONS_COPY.actionUnavailable);
}

/**
 * The Compilations surface: the schema-reader for every Compilation type,
 * then the catalog-read state and the record-read commit, then the
 * bundle-status, Collector-health and drop announcements (Story 6.4). The
 * schemas are static contract copy and render on the cold load; the registry
 * reads stream.
 */
export default function Compilations() {
  const { readState, bundleStatus, collectorHealth } = useLoaderData<CompilationsLoaderData>();
  const actionData = useActionData<CompilationsActionData>();
  return (
    <>
      <h1 className="type-title">{COMPILATIONS_COPY.heading}</h1>
      <Status tone={actionData?.status?.tone ?? "notice"} message={actionData?.status?.message} />
      <section aria-label={COMPILATIONS_COPY.schemas.heading}>
        <h2 className="type-title-sm">{COMPILATIONS_COPY.schemas.heading}</h2>
        {COMPILATION_SCHEMA_DOCS.map((doc) => (
          <SchemaReader key={doc.name} doc={doc} />
        ))}
      </section>
      <ReadState readState={readState} formKey={actionData?.recordedAt ?? "form"} />
      <BundleStatusSection status={bundleStatus} />
      <CollectorHealthSection health={collectorHealth} />
      <DropsSection health={collectorHealth} />
    </>
  );
}

/** Whole hours between `issuedAt` and `nowMs`, never negative (a future instant reads as fresh). */
export function bundleAgeHours(issuedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(issuedAt)) / 3_600_000));
}

/** True when the age is past the bound: the row must carry the word "stale". */
export function isBundleStale(ageHours: number, boundHours: number): boolean {
  return ageHours > boundHours;
}

/**
 * One drop announcement as status text. Schema failures (`schema_failed`,
 * `rejected`) name the schema failure and the stored-nothing guarantee; a
 * `queue_gap` names the lost sequences; anything else falls back to the
 * stored-nothing guarantee with its reason.
 */
export function dropAnnouncement(reason: string, count: number): string {
  const where = `(count ${String(count)}, reason ${reason})`;
  if (reason === "queue_gap") {
    return `Compilation drop ${where}: queued entries were lost before sending and those sequences never arrived.`;
  }
  if (reason === "schema_failed" || reason === "rejected") {
    return `Compilation drop ${where}: the schema failed and no partial payload was stored.`;
  }
  return `Compilation drop ${where}: no partial payload was stored.`;
}

/** One Compilation type's schema in ink on white: the version and every field. */
function SchemaReader({ doc }: { readonly doc: CompilationSchemaDoc }) {
  return (
    <section className="schema-reader" aria-label={doc.name}>
      <h3 className="type-title-sm">{doc.name}</h3>
      <p>{COMPILATIONS_COPY.schemas.version(doc.version)}</p>
      <dl>
        {doc.fields.map((fieldDoc) => (
          <div key={fieldDoc.name}>
            <dt>{fieldDoc.name}</dt>
            <dd>{fieldDoc.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface ReadStateProps {
  readonly readState: Promise<RegistryResult<CompilationCatalogReadState>>;
  /** A success remounts the form; the key is the recorded instant. */
  readonly formKey: string;
}

/** The catalog-read state under its own Suspense, with the record-read commit beside it. */
function ReadState({ readState, formKey }: ReadStateProps) {
  const copy = COMPILATIONS_COPY.read;
  const unavailable = (
    <section aria-label={copy.heading}>
      <h2 className="type-title-sm">{copy.heading}</h2>
      <p>{copy.unavailable}</p>
      <RecordForm formKey={formKey} />
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
      <Await resolve={readState} errorElement={unavailable}>
        {(result: RegistryResult<CompilationCatalogReadState>) =>
          result.kind === "ok" ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              <p>
                {result.value.read
                  ? copy.read(result.value.catalogVersion, result.value.readAt.slice(0, 10))
                  : copy.unread(result.value.catalogVersion)}
              </p>
              <RecordForm formKey={formKey} />
            </section>
          ) : result.kind === "refused" && result.error.code === SESSION_INVALID ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              <p>{COMPILATIONS_COPY.sessionEnded}</p>
              <p>
                <Link to="/sign-in">{COMPILATIONS_COPY.signInAgain}</Link>
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

/** The record-read commit: one Buyer-only submit of the current catalog version. */
function RecordForm({ formKey }: { readonly formKey: string }) {
  return (
    <Form key={formKey} method="post" aria-label={COMPILATIONS_COPY.read.heading}>
      <input type="hidden" name="intent" value="record" />
      <Button variant="primary" type="submit">
        {COMPILATIONS_COPY.record.submit(COMPILATION_CATALOG_VERSION)}
      </Button>
    </Form>
  );
}

/** A lapsed session under a streamed section: the session-ended message plus the sign-in link. */
function SectionSessionEnded({ heading }: { readonly heading: string }) {
  return (
    <section aria-label={heading}>
      <h2 className="type-title-sm">{heading}</h2>
      <p>{COMPILATIONS_COPY.sessionEnded}</p>
      <p>
        <Link to="/sign-in">{COMPILATIONS_COPY.signInAgain}</Link>
      </p>
    </section>
  );
}

/** The bundle-status rows: per service the active hash, sequence, age against the bound, freeze state and "stale". */
function BundleStatusSection({
  status,
  now = Date.now(),
}: {
  readonly status: Promise<RegistryResult<BundleStatusView[]>>;
  /** Injectable clock: tests pin the age derivation without waiting. */
  readonly now?: number;
}) {
  const copy = COMPILATIONS_COPY.status;
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
      <Await resolve={status} errorElement={unavailable}>
        {(result: RegistryResult<BundleStatusView[]>) =>
          result.kind === "ok" ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              {result.value.length === 0 ? (
                <p>{copy.empty}</p>
              ) : (
                result.value.map((row) => <BundleStatusRow key={row.applicationId} row={row} now={now} />)
              )}
            </section>
          ) : result.kind === "refused" && result.error.code === SESSION_INVALID ? (
            <SectionSessionEnded heading={copy.heading} />
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

/** One service's bundle-status row: the facts plus the "stale" word when past the bound. */
function BundleStatusRow({ row, now }: { readonly row: BundleStatusView; readonly now: number }) {
  const copy = COMPILATIONS_COPY.status;
  const ageHours = bundleAgeHours(row.issuedAt, now);
  const stale = isBundleStale(ageHours, row.stalenessBoundHours);
  return (
    <article aria-label={row.applicationId}>
      <dl>
        <div>
          <dt>Application</dt>
          <dd>{row.applicationId}</dd>
        </div>
        <div>
          <dt>Agent tool</dt>
          <dd>{row.agentToolName}</dd>
        </div>
        <div>
          <dt>Active hash</dt>
          <dd>{row.bundleHash}</dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>{row.bundleSequence}</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{copy.age(ageHours, row.stalenessBoundHours)}</dd>
        </div>
        <div>
          <dt>Freeze state</dt>
          <dd>{row.frozen ? copy.frozen : copy.unfrozen}</dd>
        </div>
      </dl>
      {stale ? (
        <p>
          <strong>{copy.stale}</strong>
        </p>
      ) : null}
    </article>
  );
}

/** The Collector-health rows: the pending count and the dropped counts by reason, per service. */
function CollectorHealthSection({
  health,
}: {
  readonly health: Promise<RegistryResult<CollectorHealthView[]>>;
}) {
  const copy = COMPILATIONS_COPY.health;
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
      <Await resolve={health} errorElement={unavailable}>
        {(result: RegistryResult<CollectorHealthView[]>) =>
          result.kind === "ok" ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              {result.value.length === 0 ? (
                <p>{copy.empty}</p>
              ) : (
                result.value.map((report) => (
                  <article key={report.applicationId} aria-label={report.applicationId}>
                    <p>{copy.pending(report.pendingCount)}</p>
                    <ul>
                      {Object.entries(report.droppedByReason).map(([reason, count]) => (
                        <li key={reason}>{copy.dropped(reason, count)}</li>
                      ))}
                    </ul>
                  </article>
                ))
              )}
            </section>
          ) : result.kind === "refused" && result.error.code === SESSION_INVALID ? (
            <SectionSessionEnded heading={copy.heading} />
          ) : (
            unavailable
          )
        }
      </Await>
    </Suspense>
  );
}

/**
 * The drop announcements: one status-text line per reason with a count above
 * zero across the health rows. Schema failures name the schema failure and
 * the stored-nothing guarantee; the empty state names that no drops were
 * reported.
 */
function DropsSection({ health }: { readonly health: Promise<RegistryResult<CollectorHealthView[]>> }) {
  const copy = COMPILATIONS_COPY.drops;
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
          <p>{COMPILATIONS_COPY.health.loading}</p>
        </section>
      }
    >
      <Await resolve={health} errorElement={unavailable}>
        {(result: RegistryResult<CollectorHealthView[]>) => {
          if (result.kind !== "ok") {
            return result.kind === "refused" && result.error.code === SESSION_INVALID ? (
              <SectionSessionEnded heading={copy.heading} />
            ) : (
              unavailable
            );
          }
          const totals = new Map<string, number>();
          for (const report of result.value) {
            for (const [reason, count] of Object.entries(report.droppedByReason)) {
              totals.set(reason, (totals.get(reason) ?? 0) + count);
            }
          }
          const announced = [...totals].filter(([, count]) => count > 0);
          return (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              {announced.length === 0 ? (
                <p>{copy.empty}</p>
              ) : (
                announced.map(([reason, count]) => <p key={reason}>{dropAnnouncement(reason, count)}</p>)
              )}
            </section>
          );
        }}
      </Await>
    </Suspense>
  );
}
