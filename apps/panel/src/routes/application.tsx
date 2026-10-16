import { Suspense, useEffect, useState } from "react";
import { Await, Link, redirect, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type {
  AcceptedDeviationRecord,
  ApplicationEvidence,
  BindingRefusalCompilation,
  Compilation,
  GateRunCompilation,
} from "@domain-harness/contract";
import { Button } from "../components/button.tsx";
import { getAcceptedDeviations, getApplicationEvidence } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Application | Domain Harness" }];

export const APPLICATION_COPY = {
  loading: "Loading the Application evidence…",
  /** The panel load rule: the structure stays and the evidence region names the miss. */
  unavailable: "The Compilation did not arrive. Try again in a few minutes.",
  empty: "This Application is listed and has no Guidance event and no Gate run.",
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
  const unavailable = <p>{APPLICATION_COPY.unavailable}</p>;
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
  const { latest, consulted, rows, refusal } = deriveEvidence(application.compilations);
  return (
    <>
      <h1 className="type-title">{application.application.description}</h1>
      {refusal === null ? null : (
        <p role="status">
          {refusal.sentence} {recoveryFor(refusal.reason)}
        </p>
      )}
      {latest === null ? (
        <p>{APPLICATION_COPY.empty}</p>
      ) : (
        <>
          <p>{APPLICATION_COPY.adherence(latest.openCount, latest.checkedCount)}</p>
          <p>{APPLICATION_COPY.verdict(latest.verdict)}</p>
        </>
      )}
      <p>{consulted ? APPLICATION_COPY.consultedYes : APPLICATION_COPY.consultedNo}</p>
      {rows.length === 0 ? null : (
        <Suspense fallback={<p aria-busy="true">{APPLICATION_COPY.loading}</p>}>
          <Await resolve={records} errorElement={<DeviationsTable rows={rows} applicationId={application.application.id} records={[]} />}>
            {(result: RegistryResult<AcceptedDeviationRecord[]>) => (
              <DeviationsTable
                rows={rows}
                applicationId={application.application.id}
                records={result.kind === "ok" ? result.value : []}
              />
            )}
          </Await>
        </Suspense>
      )}
    </>
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
    <>
      <h2 className="type-title-sm">{APPLICATION_COPY.deviationsHeading}</h2>
      <div className="table-scroll">
        <table className="standards-table">
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
                <tr key={rowKey(row.standardId, row.slotText, row.subject)} id={`deviation-row-${String(index)}`} tabIndex={-1} className="deviation-row">
                  <td>{row.status}</td>
                  <th scope="row">{row.standardId}</th>
                  <td>{row.slotText}</td>
                  <td>{row.subject}</td>
                  <td>
                    {row.status === "open" ? APPLICATION_COPY.recordOpen : (record === null ? APPLICATION_COPY.recordAccepted : APPLICATION_COPY.acceptedDetail(record.end, record.alertIntervalHours))}
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
    </>
  );
}

/** The Correction instruction in its cream inset, with a button that copies it. */
function Correction({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="correction-instruction">
      <p>{text}</p>
      <Button variant="inverse" type="button" onClick={() => void copy()}>
        {copied ? APPLICATION_COPY.copied : APPLICATION_COPY.copy}
      </Button>
    </div>
  );
}
