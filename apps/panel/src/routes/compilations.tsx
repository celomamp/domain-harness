import { Suspense } from "react";
import { Await, data, Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { COMPILATION_CATALOG_VERSION, COMPILATION_SCHEMA_DOCS, ROLE_DENIED, SESSION_INVALID } from "@domain-harness/contract";
import type { CompilationCatalogReadState, CompilationSchemaDoc, ErrorEnvelope } from "@domain-harness/contract";
import { Button } from "../components/button.tsx";
import { Status } from "../components/status.tsx";
import { getCatalogRead, recordCatalogRead } from "../registry.server.ts";
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
  actionUnavailable: "The surface is unavailable right now, so nothing was recorded. Try again in a few minutes.",
  sessionEnded: "Your session has ended, so the surface cannot be shown.",
  signInAgain: "Sign in again",
} as const;

export interface CompilationsLoaderData {
  /** The tenant's read state for the current catalog version, not awaited: the schemas show first while it loads. */
  readonly readState: Promise<RegistryResult<CompilationCatalogReadState>>;
}

/** Every role may read the Compilations surface. Without a session cookie the page goes to sign-in. */
export function loader({ request }: LoaderFunctionArgs): Response | CompilationsLoaderData {
  const token = readSessionToken(request);
  if (token === undefined) return redirect("/sign-in");
  return { readState: getCatalogRead(token) };
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
 * then the catalog-read state and the record-read commit. The schemas are
 * static contract copy and render on the cold load; only the read state
 * streams.
 */
export default function Compilations() {
  const { readState } = useLoaderData<CompilationsLoaderData>();
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
    </>
  );
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
