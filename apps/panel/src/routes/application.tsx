import { Suspense, useEffect } from "react";
import { Await, Link, redirect, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type {
  AcceptedDeviationRecord,
  ApplicationEvidence,
  ApplicationInfo,
  BindingRefusalCompilation,
  Compilation,
  GateRunCompilation,
} from "@domain-harness/contract";
import { Badge } from "../components/badge.tsx";
import { Banner } from "../components/banner.tsx";
import { Breadcrumbs } from "../components/breadcrumbs.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { EmptyState } from "../components/empty-state.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { SectionCard } from "../components/section-card.tsx";
import { Stat } from "../components/stat.tsx";
import { getAcceptedDeviations, getApplicationEvidence } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";
import { formatDate, formatDateTime } from "../format.ts";

export const meta: MetaFunction = () => [{ title: "Application | Domain Harness" }];

export const APPLICATION_COPY = {
  loading: "Loading the Application evidence…",
  /** The panel load rule: the structure stays and the evidence region names the miss. */
  unavailable: "The Compilation did not arrive. Try again in a few minutes.",
  empty: "This Application is listed and has no Guidance event and no Gate run.",
  emptyExplanation: "Evidence appears here after the first Gate run or Guidance event.",
  noGateRun: "No Gate run yet",
  adherence: (open: number, checked: number) =>
    `Adherence ${String(checked - open)} of ${String(checked)} checked Standards on the last Gate run.`,
  verdict: (verdict: string) => `Gate run: ${verdict}.`,
  consultedYes: "Guidance was consulted: yes.",
  consultedNo: "Guidance was consulted: no.",
  deviationsHeading: "Deviations",
  headers: ["Status", "Standard", "Conflict slot", "Subject", "Record"],
  recordOpen: "Deviation open.",
  recordAccepted: "Deviation accepted.",
  acceptedDetail: (end: string, intervalHours: number) =>
    `End date ${end.slice(0, 10)}. Alert every ${String(intervalHours)} hours.`,
  accept: "Accept this Deviation",
  copy: "Copy",
  copied: "Copied",
  unboundCommitFirst: "The repository has no commit. Commit once and retry.",
  unboundMissingFile:
    "The Project identification file is missing or unreadable, or its Application id is absent from the bundle. Restore that file or ask the Buyer to place the Application.",
  unboundUnavailable: "The binding outcome could not be read. Try again in a few minutes.",
  backToInventory: "Back to Inventory",
  listed: (date: string) => `Listed ${date}`,
  summary: {
    adherence: "Adherence",
    verdict: "Gate verdict",
    guidance: "Guidance consulted",
    openDeviations: "Open deviations",
  },
  history: {
    heading: "History",
    empty: "No Compilation yet.",
  },
  facts: {
    heading: "Application facts",
    project: "Project",
    agentTool: "Agent tool",
    created: "Created",
    id: "Application id",
  },
} as const;

export interface ApplicationLoaderData {
  /** The Application plus its stored Compilations, not awaited: the structure streams first. */
  readonly evidence: Promise<RegistryResult<ApplicationEvidence>>;
  /** The stored Accepted deviations, for the accepted rows' end date and alert interval. */
  readonly records: Promise<RegistryResult<AcceptedDeviationRecord[]>>;
}

/**
 * One Application's evidence. Every role may read. Without a session cookie
 * the page goes to sign-in; otherwise the evidence and the stored acceptances
 * stream in.
 */
export function loader({ request, params }: LoaderFunctionArgs): Response | ApplicationLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return {
    evidence: getApplicationEvidence(token, params["applicationId"] ?? ""),
    records: getAcceptedDeviations(token),
  };
}

/** One deviation row of the latest Gate run, with its Correction when a Deviation Compilation carries it. */
export interface DeviationRow {
  readonly standardId: string;
  readonly slotText: string;
  readonly subject: string;
  readonly status: "open" | "accepted";
  readonly correction: string | null;
}

const rowKey = (standardId: string, slotText: string, subject: string): string =>
  `${standardId}|${slotText}|${subject}`;

/**
 * Derive the surface from stored Compilations: the latest Gate run (by
 * sequence), whether any Guidance event exists, the deviation rows of that
 * run with Corrections joined from Deviation Compilations by match key, and
 * the binding refusal when it is newer than the latest Gate run (or when no
 * Gate run exists at all).
 */
export function deriveEvidence(compilations: readonly Compilation[]): {
  readonly latest: GateRunCompilation | null;
  readonly consulted: boolean;
  readonly rows: readonly DeviationRow[];
  readonly refusal: BindingRefusalCompilation | null;
} {
  let latest: GateRunCompilation | null = null;
  let refusal: BindingRefusalCompilation | null = null;
  let consulted = false;
  const corrections = new Map<string, string>();
  for (const entry of compilations) {
    if (entry.type === "guidance") consulted = true;
    if (entry.type === "gate_run" && (latest === null || entry.sequence >= latest.sequence)) latest = entry;
    if (entry.type === "binding_refusal" && (refusal === null || entry.sequence >= refusal.sequence)) refusal = entry;
    if (entry.type === "deviation") {
      const slot = entry.deviation.slot;
      corrections.set(
        rowKey(entry.deviation.standardId, `${slot.moduleKind}/${slot.slotKind}/${slot.name}`, entry.deviation.subject),
        entry.deviation.correction,
      );
    }
  }
  const rows: DeviationRow[] =
    latest === null
      ? []
      : latest.deviations.map((summary) => {
          const slotText = `${summary.slot.moduleKind}/${summary.slot.slotKind}/${summary.slot.name}`;
          return {
            standardId: summary.standardId,
            slotText,
            subject: summary.subject,
            status: summary.status,
            correction: corrections.get(rowKey(summary.standardId, slotText, summary.subject)) ?? null,
          };
        });
  const showRefusal = refusal !== null && (latest === null || refusal.sequence > latest.sequence);
  return { latest, consulted, rows, refusal: showRefusal ? refusal : null };
}

const recoveryFor = (reason: BindingRefusalCompilation["reason"]): string =>
  reason === "commit_first" ? APPLICATION_COPY.unboundCommitFirst : APPLICATION_COPY.unboundMissingFile;

/** The Conflict slot's name comparison, as the evaluator's slot rule normalizes it. */
const normalizedName = (name: string): string => name.trim().normalize("NFC").toLowerCase();

/** The stored acceptance matching a deviation row, or `null` when none does. */
function matchingRecord(
  records: readonly AcceptedDeviationRecord[],
  applicationId: string,
  row: DeviationRow,
): AcceptedDeviationRecord | null {
  const [moduleKind, slotKind, ...nameParts] = row.slotText.split("/");
  const name = nameParts.join("/");
  return (
    records.find(
      (record) =>
        record.applicationId === applicationId &&
        record.standardId === row.standardId &&
        record.subject === row.subject &&
        record.slot.moduleKind === moduleKind &&
        record.slot.slotKind === slotKind &&
        normalizedName(record.slot.name) === normalizedName(name),
    ) ?? null
  );
}

/** One stored Compilation as a History entry, in the sequence order the page shows (newest first). */
export interface CompilationHistoryItem {
  readonly id: string;
  readonly type: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly detail: string;
}

/** The human label for each Compilation type, sentence case. */
const HISTORY_TYPES: Readonly<Record<Compilation["type"], string>> = {
  guidance: "Guidance",
  gate_run: "Gate run",
  deviation: "Deviation",
  binding_refusal: "Binding refusal",
  bundle_status: "Bundle status",
  collector_health: "Collector health",
};

/** The readable, sentence-case History detail for a binding refusal, instead of the raw reason. */
function bindingRefusalDetail(reason: BindingRefusalCompilation["reason"]): string {
  switch (reason) {
    case "commit_first":
      return "The repository has no commit.";
    case "missing_identification_file":
      return "The Project identification file is missing.";
    case "unknown_application":
      return "The Application id is not in the active bundle.";
    case "unavailable":
      return "The binding outcome could not be read.";
  }
}

/** The short fact each Compilation carries: its verdict, outcome, refusal reason, and so on. */
function historyDetail(entry: Compilation): string {
  switch (entry.type) {
    case "gate_run":
      return `Verdict ${entry.verdict}.`;
    case "guidance":
      return `Outcome ${entry.outcome}.`;
    case "deviation":
      return `Status ${entry.deviation.status}.`;
    case "binding_refusal":
      return bindingRefusalDetail(entry.reason);
    case "bundle_status":
      return `Bundle sequence ${String(entry.bundleSequence)}.`;
    case "collector_health":
      return `Pending ${String(entry.pendingCount)}.`;
  }
}

/**
 * The History section's rows: every stored Compilation in reverse sequence
 * order (newest first), each with its type, sequence, formatted timestamp and
 * one short fact. Built only from what is already stored.
 */
export function compilationHistory(compilations: readonly Compilation[]): readonly CompilationHistoryItem[] {
  return [...compilations]
    .sort((left, right) => right.sequence - left.sequence)
    .map((entry) => ({
      id: entry.idempotencyKey,
      type: HISTORY_TYPES[entry.type],
      sequence: entry.sequence,
      occurredAt: formatDateTime(entry.occurredAt),
      detail: historyDetail(entry),
    }));
}

/** The aside's Application facts: the Project name, the agent tool and the listed date. */
export interface ApplicationFacts {
  readonly project: string;
  readonly agentTool: string;
  readonly created: string;
}

export function applicationFacts(application: ApplicationInfo): ApplicationFacts {
  return {
    project: application.project.name,
    agentTool: application.agentTool ?? "—",
    created: formatDate(application.createdAt),
  };
}

/**
 * The Application surface: the description as heading, the latest Adherence
 * as text, the verdict, whether Guidance was consulted, the deviation rows
 * and any binding-refusal failure. The structure renders first; the evidence
 * fills in when its Compilation arrives.
 */
export default function Application() {
  const { evidence, records } = useLoaderData<ApplicationLoaderData>();
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "") return;
    const target = document.querySelector(location.hash);
    if (target instanceof HTMLElement) target.focus();
  }, [location.hash]);
  const unavailable = <Banner tone="denial">{APPLICATION_COPY.unavailable}</Banner>;
  return (
    <Suspense
      fallback={
        <section aria-label="Application evidence" aria-busy="true">
          <p>{APPLICATION_COPY.loading}</p>
        </section>
      }
    >
      <Await resolve={evidence} errorElement={unavailable}>
        {(result: RegistryResult<ApplicationEvidence>) =>
          result.kind !== "ok" ? (
            unavailable
          ) : (
            <Evidence application={result.value} records={records} />
          )
        }
      </Await>
    </Suspense>
  );
}

function Evidence({
  application,
  records,
}: {
  readonly application: ApplicationEvidence;
  readonly records: Promise<RegistryResult<AcceptedDeviationRecord[]>>;
}) {
  const app = application.application;
  const { latest, consulted, rows, refusal } = deriveEvidence(application.compilations);
  const facts = applicationFacts(app);
  const history = compilationHistory(application.compilations);
  return (
    <div className="application-layout">
      <div className="application-main">
        <Breadcrumbs items={[{ label: "Inventory", to: "/inventory" }, { label: app.description }]} />
        <PageHeader
          title={app.description}
          actions={<CopyButton value={app.id} label="Copy id" />}
          meta={
            <>
              <Link to={`/projects?project=${encodeURIComponent(app.project.id)}`}>{app.project.name}</Link>
              <Badge tone="outline">{facts.agentTool}</Badge>
              <span>{APPLICATION_COPY.listed(facts.created)}</span>
            </>
          }
        />
        {refusal === null ? null : (
          <Banner tone="denial">
            <p>
              {refusal.sentence} {recoveryFor(refusal.reason)}
            </p>
            <p>
              <Link to="/inventory">{APPLICATION_COPY.backToInventory}</Link>
            </p>
          </Banner>
        )}
        {latest === null && !consulted ? (
          <EmptyState
            icon="application"
            title={APPLICATION_COPY.noGateRun}
            description={`${APPLICATION_COPY.empty} ${APPLICATION_COPY.emptyExplanation}`}
          />
        ) : (
          <>
            <Summary latest={latest} consulted={consulted} />
            <DeviationsSection rows={rows} application={app} records={records} />
          </>
        )}
        <HistorySection history={history} />
      </div>
      <aside className="application-aside">
        <SectionCard title={APPLICATION_COPY.facts.heading}>
          <dl className="application-facts">
            <div>
              <dt>{APPLICATION_COPY.facts.project}</dt>
              <dd>
                <Link to={`/projects?project=${encodeURIComponent(app.project.id)}`}>{facts.project}</Link>
              </dd>
            </div>
            <div>
              <dt>{APPLICATION_COPY.facts.agentTool}</dt>
              <dd>{facts.agentTool}</dd>
            </div>
            <div>
              <dt>{APPLICATION_COPY.facts.created}</dt>
              <dd>{facts.created}</dd>
            </div>
            <div>
              <dt>{APPLICATION_COPY.facts.id}</dt>
              <dd>{app.id}</dd>
            </div>
          </dl>
        </SectionCard>
      </aside>
    </div>
  );
}

/** The summary facts: Adherence, the Gate verdict, whether Guidance was consulted and the open Deviations. */
function Summary({ latest, consulted }: { readonly latest: GateRunCompilation | null; readonly consulted: boolean }) {
  return (
    <div className="application-summary">
      {latest === null ? (
        <p className="application-summary__no-gate-run type-body-sm">{APPLICATION_COPY.noGateRun}</p>
      ) : (
        <>
          <Stat
            label={APPLICATION_COPY.summary.adherence}
            value={`${String(latest.checkedCount - latest.openCount)} of ${String(latest.checkedCount)}`}
          />
          <div className="application-summary__fact" role="group" aria-label={APPLICATION_COPY.summary.verdict}>
            <span className="application-summary__label type-body-sm">{APPLICATION_COPY.summary.verdict}</span>
            <Badge tone="neutral" icon={latest.verdict === "pass" ? "check" : "alert"}>
              {latest.verdict}
            </Badge>
          </div>
          <Stat
            label={APPLICATION_COPY.summary.openDeviations}
            value={`${String(latest.openCount)} open`}
          />
        </>
      )}
      <div className="application-summary__fact" role="group" aria-label={APPLICATION_COPY.summary.guidance}>
        <span className="application-summary__label type-body-sm">{APPLICATION_COPY.summary.guidance}</span>
        <Badge tone="neutral" icon={consulted ? "check" : "dash"}>{consulted ? "yes" : "no"}</Badge>
      </div>
    </div>
  );
}

/** The Deviations section: the accepted-deviation rows as a table, streamed from the stored acceptances. */
function DeviationsSection({
  rows,
  application,
  records,
}: {
  readonly rows: readonly DeviationRow[];
  readonly application: ApplicationInfo;
  readonly records: Promise<RegistryResult<AcceptedDeviationRecord[]>>;
}) {
  if (rows.length === 0) return null;
  return (
    <SectionCard title={APPLICATION_COPY.deviationsHeading} id="deviations">
      <Suspense fallback={<p aria-busy="true">{APPLICATION_COPY.loading}</p>}>
        <Await
          resolve={records}
          errorElement={<DeviationsTable rows={rows} applicationId={application.id} records={[]} />}
        >
          {(result: RegistryResult<AcceptedDeviationRecord[]>) => (
            <DeviationsTable
              rows={rows}
              applicationId={application.id}
              records={result.kind === "ok" ? result.value : []}
            />
          )}
        </Await>
      </Suspense>
    </SectionCard>
  );
}

function DeviationsTable({
  rows,
  applicationId,
  records,
}: {
  readonly rows: readonly DeviationRow[];
  readonly applicationId: string;
  readonly records: readonly AcceptedDeviationRecord[];
}) {
  return (
    <div className="data-table__scroll" tabIndex={0}>
      <table className="data-table deviations-table">
        <caption className="visually-hidden">{APPLICATION_COPY.deviationsHeading}</caption>
        <thead>
          <tr>
            {APPLICATION_COPY.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const record = row.status === "accepted" ? matchingRecord(records, applicationId, row) : null;
            return (
              <tr
                key={rowKey(row.standardId, row.slotText, row.subject)}
                id={`deviation-row-${String(index)}`}
                tabIndex={-1}
                className="deviation-card"
              >
                <td>
                  {row.status === "open" ? (
                    <Badge tone="solid" icon="dot">
                      {row.status}
                    </Badge>
                  ) : (
                    <Badge tone="outline" icon="check">
                      {row.status}
                    </Badge>
                  )}
                </td>
                <th scope="row">
                  {row.standardId}
                  <CopyButton value={row.standardId} label="Copy id" />
                </th>
                <td>{row.slotText}</td>
                <td>{row.subject}</td>
                <td>
                  {row.status === "open"
                    ? APPLICATION_COPY.recordOpen
                    : record === null
                      ? APPLICATION_COPY.recordAccepted
                      : APPLICATION_COPY.acceptedDetail(record.end, record.alertIntervalHours)}
                  {row.correction === null ? null : <Correction text={row.correction} />}
                  {row.status === "open" ? (
                    <Link
                      to={`/accepted-deviation?application=${encodeURIComponent(applicationId)}&standardId=${encodeURIComponent(row.standardId)}&slot=${encodeURIComponent(row.slotText)}&subject=${encodeURIComponent(row.subject)}&returnTo=${encodeURIComponent(`/applications/${encodeURIComponent(applicationId)}#deviation-row-${String(index)}`)}`}
                    >
                      {APPLICATION_COPY.accept}
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Correction instruction in its cream inset, with a button that copies it. */
function Correction({ text }: { readonly text: string }) {
  return (
    <div className="correction-instruction">
      <p>{text}</p>
      <CopyButton value={text} />
    </div>
  );
}

/** The History section: every stored Compilation in reverse sequence order. */
function HistorySection({ history }: { readonly history: readonly CompilationHistoryItem[] }) {
  return (
    <SectionCard title={APPLICATION_COPY.history.heading}>
      {history.length === 0 ? (
        <p>{APPLICATION_COPY.history.empty}</p>
      ) : (
        <ol className="history-list">
          {history.map((item) => (
            <li key={item.id} className="history-item">
              <strong className="history-item__type">{item.type}</strong>
              <span className="history-item__meta type-body-sm">
                Sequence {String(item.sequence)} · {item.occurredAt}
              </span>
              <span className="history-item__detail type-body-sm">{item.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
