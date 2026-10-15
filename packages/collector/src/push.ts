/**
 * The single outbound push to the panel ingest endpoint (Story 6.2): one POST
 * of exactly one validated Compilation to the ingest path with the tenant
 * bearer credential and a bounded timeout. Mirrors the service puller pattern
 * (`apps/service/src/bundles/puller.ts`: bounded timeout, never-throws typed
 * failures); read-only reference, never imported. No retries, no backoff, no
 * queue — all 6.3, which reuses these typed refusals to keep queueing.
 */
import { COMPILATION_API_PATHS } from "@domain-harness/contract";
import type { Compilation } from "@domain-harness/contract";

/** Bound on one outbound POST and its body read; a hung panel never wedges the caller. */
export const PUSH_TIMEOUT_MS = 30_000;

/** One outbound push: where to send what, with whose credential. */
export interface PushCompilationInput {
  /** Fetch implementation; defaults to the global fetch (tests inject a stub or hit a local server). */
  readonly fetchImpl?: typeof fetch;
  /** Outbound base URL of the panel, no trailing slash. */
  readonly baseUrl: string;
  /** The tenant's registry service credential, treated opaquely. */
  readonly credential: string;
  /** One validated Compilation (validate with `validateForSend` first). */
  readonly compilation: Compilation;
  /** Override of the outbound timeout for tests; defaults to {@link PUSH_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * One push outcome. Never throws: `sent` on 201/200, `catalog_unread` on 403
 * (the tenant recorded no read of the current catalog version), `unauthorized`
 * on 401, `invalid` on 400, and `transport_failed` on timeout, reset, an
 * unreachable panel, or any unexpected status (nothing lost: the caller queues
 * in 6.3).
 */
export type PushResult =
  | { readonly ok: true; readonly sent: true; readonly status: 200 | 201 }
  | { readonly ok: false; readonly reason: "catalog_unread"; readonly status: 403 }
  | { readonly ok: false; readonly reason: "unauthorized"; readonly status: 401 }
  | { readonly ok: false; readonly reason: "invalid"; readonly status: 400; readonly detail: string }
  | { readonly ok: false; readonly reason: "transport_failed"; readonly detail: string };

/**
 * POST one validated Compilation to the ingest path. Never throws: any fetch
 * failure is a `transport_failed` outcome, and refusals are typed by status
 * for 6.3's queue.
 */
export async function pushCompilation(input: PushCompilationInput): Promise<PushResult> {
  const url = `${input.baseUrl.replace(/\/+$/, "")}${COMPILATION_API_PATHS.compilations}`;
  const timeoutMs = input.timeoutMs ?? PUSH_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.credential}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(input.compilation),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "the connection failed";
    return { ok: false, reason: "transport_failed", detail };
  }

  const status = response.status;
  if (status === 200 || status === 201) return { ok: true, sent: true, status };
  if (status === 403) return { ok: false, reason: "catalog_unread", status };
  if (status === 401) return { ok: false, reason: "unauthorized", status };
  if (status === 400) {
    let detail: string;
    try {
      detail = await response.text();
    } catch (cause) {
      detail = cause instanceof Error ? cause.message : "the response body could not be read";
    }
    return { ok: false, reason: "invalid", status, detail };
  }
  let detail = `unexpected status ${String(status)}`;
  try {
    const text = await response.text();
    if (text !== "") detail = `${detail}: ${text}`;
  } catch {
    detail = `unexpected status ${String(status)}`;
  }
  return { ok: false, reason: "transport_failed", detail };
}
