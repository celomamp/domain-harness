import { Suspense } from "react";
import { Await, Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { ApplicationInfo, ApplicationList } from "@domain-harness/contract";
import { getApplications } from "../registry.server.ts";
import type { RegistryResult } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

export const meta: MetaFunction = () => [{ title: "Inventory | Domain Harness" }];

export const INVENTORY_COPY = {
  heading: "Inventory",
  caption: "Applications",
  headers: ["Application", "Project", "Placement", "Listed"],
  fromFlow: "New-application flow",
  registered: "Registered",
  evidence: "Listed before any Gate run. Compilation evidence fills in later.",
  empty: "No Application yet.",
  loading: "Loading the Applications…",
  unavailable: "The Inventory is unavailable right now. Try again in a few minutes.",
} as const;

export interface InventoryLoaderData {
  /** Every Application of the Company, not awaited: the heading shows first while it loads. */
  readonly applications: Promise<RegistryResult<ApplicationList>>;
}

/** Every role may read the Inventory. Without a session cookie the page goes to sign-in. */
export function loader({ request }: LoaderFunctionArgs): Response | InventoryLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { applications: getApplications(token) };
}

/**
 * Inventory: every Application of the Company at once, in the registry's
 * order (creation time, then id). It never names who created an Application.
 */
export default function Inventory() {
  const { applications } = useLoaderData<InventoryLoaderData>();
  const unavailable = <p>{INVENTORY_COPY.unavailable}</p>;
  return (
    <>
      <h1 className="type-title">{INVENTORY_COPY.heading}</h1>
      <Suspense
        fallback={
          <section aria-label={INVENTORY_COPY.caption} aria-busy="true">
            <p>{INVENTORY_COPY.loading}</p>
          </section>
        }
      >
        <Await resolve={applications} errorElement={unavailable}>
          {(result: RegistryResult<ApplicationList>) =>
            result.kind !== "ok" ? (
              unavailable
            ) : result.value.applications.length === 0 ? (
              <p className="type-display">{INVENTORY_COPY.empty}</p>
            ) : (
              <ApplicationsTable applications={result.value.applications} />
            )
          }
        </Await>
      </Suspense>
    </>
  );
}

function ApplicationsTable({ applications }: { readonly applications: readonly ApplicationInfo[] }) {
  return (
    <>
      <div className="table-scroll">
        <table className="standards-table">
          <caption className="type-title-sm">{INVENTORY_COPY.caption}</caption>
          <thead>
            <tr>
              {INVENTORY_COPY.headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id}>
                <th scope="row">
                  <Link to={`/applications/${encodeURIComponent(application.id)}`}>{application.description}</Link>
                </th>
                <td>{application.project.name}</td>
                <td>{application.fromFlow ? INVENTORY_COPY.fromFlow : INVENTORY_COPY.registered}</td>
                <td>{application.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{INVENTORY_COPY.evidence}</p>
    </>
  );
}
