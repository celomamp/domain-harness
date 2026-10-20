import { Suspense, useEffect, useState } from "react";
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
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { Button } from "../components/button.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SectionCard } from "../components/section-card.tsx";
import { Skeleton } from "../components/skeleton.tsx";
import { Stat } from "../components/stat.tsx";
import { Status } from "../components/status.tsx";
import { Tabs } from "../components/tabs.tsx";
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
    fresh: "fresh",
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
    banner: (count: number) => `Compilation drops reported: ${String(count)}. See Drops for details.`,
    emptyDescription: "No drop records have arrived from the Collector.",
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
  const [activeTab, setActiveTab] = useState<"overview" | "schemas" | "drops">("overview");
  const [dropStatusMessage, setDropStatusMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void collectorHealth.then(
      (result) => {
        if (!current) return;
        const drops = result.kind === "ok" ? compilationsSummary([], result.value).drops : 0;
        setDropStatusMessage(drops > 0 ? COMPILATIONS_COPY.drops.banner(drops) : undefined);
      },
      () => { if (current) setDropStatusMessage(undefined); },
    );
    return () => { current = false; };
  }, [collectorHealth]);

  const tabs = [
    { id: "overview", label: "Overview", panelId: "overview-panel" },
    { id: "schemas", label: "Schemas", panelId: "schemas-panel" },
    { id: "drops", label: "Drops", panelId: "drops-panel" },
  ] as const;
  return (
    <>
      <PageHeader title={COMPILATIONS_COPY.heading} />
      <Status
        tone={actionData?.status?.tone ?? "notice"}
        message={actionData?.status?.message ?? dropStatusMessage}
      />
      <CompilationsSummarySection bundles={bundleStatus} health={collectorHealth} />
      <Tabs
        label="Compilations views"
        tabs={tabs}
        value={activeTab}
        onChange={(id) => { setActiveTab(id as typeof activeTab); }}
      />
      <section
        id="overview-panel"
        className="compilations-panel"
        role="tabpanel"
        aria-labelledby="tab-overview"
        tabIndex={0}
        hidden={activeTab !== "overview"}
      >
        <DropOverviewBanner health={collectorHealth} />
        <BundleStatusSection status={bundleStatus} />
        <CollectorHealthSection health={collectorHealth} />
      </section>
      <section
        id="schemas-panel"
        className="compilations-panel"
        role="tabpanel"
        aria-labelledby="tab-schemas"
        tabIndex={0}
        hidden={activeTab !== "schemas"}
      >
        <ReadState readState={readState} formKey={actionData?.recordedAt ?? "form"} />
        <section className="schema-accordion" aria-label={COMPILATIONS_COPY.schemas.heading}>
          <h2 className="type-title-sm">{COMPILATIONS_COPY.schemas.heading}</h2>
          {COMPILATION_SCHEMA_DOCS.map((doc) => (
            <SchemaReader key={doc.name} doc={doc} />
          ))}
        </section>
      </section>
      <section
        id="drops-panel"
        className="compilations-panel"
        role="tabpanel"
        aria-labelledby="tab-drops"
        tabIndex={0}
        hidden={activeTab !== "drops"}
      >
        <DropsSection health={collectorHealth} />
      </section>
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

/** Aggregate the four overview metrics from the latest registry reads. */
export function compilationsSummary(
  bundles: readonly BundleStatusView[],
  health: readonly CollectorHealthView[],
): { services: number; stale: number; pending: number; drops: number } {
  const now = Date.now();
  return {
    services: bundles.length,
    stale: bundles.filter((row) => isBundleStale(bundleAgeHours(row.issuedAt, now), row.stalenessBoundHours)).length,
    pending: health.reduce((total, report) => total + report.pendingCount, 0),
    drops: health.reduce(
      (total, report) => total + Object.values(report.droppedByReason).reduce((count, dropped) => count + dropped, 0),
      0,
    ),
  };
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

/** Four independently resolved values, with an honest placeholder per read. */
function CompilationsSummarySection({
  bundles,
  health,
}: {
  readonly bundles: Promise<RegistryResult<BundleStatusView[]>>;
  readonly health: Promise<RegistryResult<CollectorHealthView[]>>;
}) {
  const [bundleSummary, setBundleSummary] = useState<ReturnType<typeof compilationsSummary> | null>(null);
  const [healthSummary, setHealthSummary] = useState<ReturnType<typeof compilationsSummary> | null>(null);

  useEffect(() => {
    let current = true;
    void bundles.then(
      (result) => { if (current) setBundleSummary(result.kind === "ok" ? compilationsSummary(result.value, []) : null); },
      () => { if (current) setBundleSummary(null); },
    );
    return () => { current = false; };
  }, [bundles]);

  useEffect(() => {
    let current = true;
    void health.then(
      (result) => { if (current) setHealthSummary(result.kind === "ok" ? compilationsSummary([], result.value) : null); },
      () => { if (current) setHealthSummary(null); },
    );
    return () => { current = false; };
  }, [health]);

  return (
    <div className="compilations-summary" role="group" aria-label="Compilations summary">
      <BundleSummaryStats summary={bundleSummary} />
      <HealthSummaryStats summary={healthSummary} />
    </div>
  );
}

function BundleSummaryStats({
  summary,
}: {
  readonly summary: ReturnType<typeof compilationsSummary> | null;
}) {
  return (
    <div className="compilations-summary__group">
      <Stat label="Services reporting" value={summary === null ? "—" : String(summary.services)} />
      <Stat label="Stale" value={summary === null ? "—" : String(summary.stale)} />
    </div>
  );
}

function HealthSummaryStats({
  summary,
}: {
  readonly summary: ReturnType<typeof compilationsSummary> | null;
}) {
  return (
    <div className="compilations-summary__group">
      <Stat label="Pending" value={summary === null ? "—" : String(summary.pending)} />
      <Stat label="Drops" value={summary === null ? "—" : String(summary.drops)} />
    </div>
  );
}

/** One Compilation type's schema in ink on white: the version and every field. */
function SchemaReader({ doc }: { readonly doc: CompilationSchemaDoc }) {
  return (
    <details className="schema-reader">
      <summary>{doc.name}</summary>
      <div className="schema-reader__content">
        <p>{COMPILATIONS_COPY.schemas.version(doc.version)}</p>
        <dl>
          {doc.fields.map((fieldDoc) => (
            <div key={fieldDoc.name}>
              <dt>{fieldDoc.name}</dt>
              <dd>{fieldDoc.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
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
      <Banner tone="notice">{copy.unavailable}</Banner>
      <RecordForm formKey={formKey} />
    </section>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={copy.heading} aria-busy="true">
          <h2 className="type-title-sm">{copy.heading}</h2>
          <p>{copy.loading}</p>
          <Skeleton lines={2} />
        </section>
      }
    >
      <Await resolve={readState} errorElement={unavailable}>
        {(result: RegistryResult<CompilationCatalogReadState>) =>
          result.kind === "ok" ? (
            <section aria-label={copy.heading}>
              <h2 className="type-title-sm">{copy.heading}</h2>
              <p className="catalog-read-state">
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

/** The bundle-status table: one row per service. */
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
    <SectionCard title={copy.heading}>
      <Banner tone="notice">{copy.unavailable}</Banner>
    </SectionCard>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={copy.heading} aria-busy="true">
          <h2 className="type-title-sm">{copy.heading}</h2>
          <p>{copy.loading}</p>
          <Skeleton lines={5} />
        </section>
      }
    >
      <Await resolve={status} errorElement={unavailable}>
        {(result: RegistryResult<BundleStatusView[]>) =>
          result.kind === "ok" ? (
            <SectionCard title={copy.heading}>
              {result.value.length === 0 ? (
                <EmptyState icon="compilations" title={copy.empty} />
              ) : (
                <div className="bundle-table-scroll" role="region" aria-label="Bundle status table" tabIndex={0}>
                  <table className="bundle-table">
                    <caption>{copy.heading}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Application</th>
                        <th scope="col">Agent tool</th>
                        <th scope="col">Active hash</th>
                        <th scope="col">Sequence</th>
                        <th scope="col">Age vs bound</th>
                        <th scope="col">Freeze state</th>
                        <th scope="col">Status badge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.value.map((row) => (
                        <BundleStatusRow key={row.applicationId} row={row} now={now} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
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

/** One service's status, including a copyable hash and freshness/freeze badges. */
function BundleStatusRow({ row, now }: { readonly row: BundleStatusView; readonly now: number }) {
  const copy = COMPILATIONS_COPY.status;
  const ageHours = bundleAgeHours(row.issuedAt, now);
  const stale = isBundleStale(ageHours, row.stalenessBoundHours);
  return (
    <tr>
      <td className="bundle-table__application">{row.applicationId}</td>
      <td>{row.agentToolName}</td>
      <td className="bundle-table__hash-cell">
        <code className="bundle-table__hash">{row.bundleHash}</code>
        <CopyButton value={row.bundleHash} label="Copy hash" copiedLabel="Hash copied" />
      </td>
      <td>{row.bundleSequence}</td>
      <td>{copy.age(ageHours, row.stalenessBoundHours)}</td>
      <td>
        <Badge tone={row.frozen ? "solid" : "neutral"}>{row.frozen ? copy.frozen : copy.unfrozen}</Badge>
      </td>
      <td>
        <Badge tone={stale ? "solid" : "outline"}>{stale ? copy.stale : copy.fresh}</Badge>
      </td>
    </tr>
  );
}

/** Collector health cards: pending items and dropped counts grouped by reason. */
function CollectorHealthSection({
  health,
}: {
  readonly health: Promise<RegistryResult<CollectorHealthView[]>>;
}) {
  const copy = COMPILATIONS_COPY.health;
  const unavailable = (
    <SectionCard title={copy.heading}>
      <Banner tone="notice">{copy.unavailable}</Banner>
    </SectionCard>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={copy.heading} aria-busy="true">
          <h2 className="type-title-sm">{copy.heading}</h2>
          <p>{copy.loading}</p>
          <Skeleton lines={4} />
        </section>
      }
    >
      <Await resolve={health} errorElement={unavailable}>
        {(result: RegistryResult<CollectorHealthView[]>) =>
          result.kind === "ok" ? (
            <SectionCard title={copy.heading}>
              {result.value.length === 0 ? (
                <EmptyState icon="compilations" title={copy.empty} />
              ) : (
                <div className="health-cards">
                  {result.value.map((report) => (
                    <article key={report.applicationId} className="health-card" aria-label={report.applicationId}>
                      <h3>{report.applicationId}</h3>
                      <p>{copy.pending(report.pendingCount)}</p>
                      <h4>Dropped by reason</h4>
                      {Object.entries(report.droppedByReason).length === 0 ? (
                        <p>No drops reported for this Application.</p>
                      ) : (
                        <ul>
                          {Object.entries(report.droppedByReason).map(([reason, count]) => (
                            <li key={reason}>{copy.dropped(reason, count)}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </SectionCard>
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

/** A non-live overview notice; the Drops tab carries the complete reason lines. */
function DropOverviewBanner({ health }: { readonly health: Promise<RegistryResult<CollectorHealthView[]>> }) {
  return (
    <Suspense fallback={null}>
      <Await resolve={health} errorElement={null}>
        {(result: RegistryResult<CollectorHealthView[]>) => {
          if (result.kind !== "ok") return null;
          const count = compilationsSummary([], result.value).drops;
          return count > 0 ? (
            <div className="drop-banner">
              <Banner tone="notice">{COMPILATIONS_COPY.drops.banner(count)}</Banner>
            </div>
          ) : null;
        }}
      </Await>
    </Suspense>
  );
}

/** Aggregate reason counts without mutating the streamed reports. */
function dropTotals(health: readonly CollectorHealthView[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const report of health) {
    for (const [reason, count] of Object.entries(report.droppedByReason)) {
      totals.set(reason, (totals.get(reason) ?? 0) + count);
    }
  }
  return [...totals].filter(([, count]) => count > 0);
}

/** One drop-announcement line per reason, including the stored-nothing guarantee. */
function DropsSection({ health }: { readonly health: Promise<RegistryResult<CollectorHealthView[]>> }) {
  const copy = COMPILATIONS_COPY.drops;
  const unavailable = (
    <SectionCard title={copy.heading}>
      <Banner tone="notice">{copy.unavailable}</Banner>
    </SectionCard>
  );
  return (
    <Suspense
      fallback={
        <section aria-label={copy.heading} aria-busy="true">
          <h2 className="type-title-sm">{copy.heading}</h2>
          <p>{COMPILATIONS_COPY.health.loading}</p>
          <Skeleton lines={3} />
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
          const announced = dropTotals(result.value);
          return (
            <SectionCard title={copy.heading}>
              {announced.length === 0 ? (
                <EmptyState
                  icon="compilations"
                  title={copy.empty}
                  description={copy.emptyDescription}
                />
              ) : (
                <div className="drop-announcements">
                  {announced.map(([reason, count]) => <p key={reason}>{dropAnnouncement(reason, count)}</p>)}
                </div>
              )}
            </SectionCard>
          );
        }}
      </Await>
    </Suspense>
  );
}
