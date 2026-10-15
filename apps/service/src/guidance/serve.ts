/**
 * The Guidance serving unit (Story 4.4): `serveGuidanceCall` answers ONE
 * tool call, never throws, and is stateless — the adapter re-reads the
 * identity headers from every HTTP request and this unit caches nothing
 * across requests.
 *
 * The decision order is fixed:
 *   1. identity first — `resolveGuidanceIdentity` (Story 4.3) is the one
 *      binding/refusal check every surface shares (AD-19); anything but
 *      `bound` answers `unbound` with that outcome's fixed sentence (a
 *      copied fingerprint surfaces as the `refused` reason: the refusal row
 *      was already recorded by the identity unit). Nothing else is resolved
 *      for any other Project's Standards.
 *   2. the `bundledState` staleness flag — `stale` is true, and the response
 *      says `bundle stale`, when the pinned bundle is past its bound and not
 *      frozen; a stale service still answers from the active bundle.
 *   3. core resolution — the Effective Standard set comes ONLY from the
 *      bundle payload through `resolveEffectiveSet` (standards →
 *      `SlotHolder`s via `entrySlot` at the Standard's `project.id`, tree =
 *      `payload.tree.projects`, locked ids = `payload.tree.lockedRules`
 *      entries deduplicated by `standardId`); the Project resolved from the
 *      bundle by the identity step is the only Project used — the advisory
 *      Project id never influences serving. A set that cannot be resolved
 *      (invalid payload, or a `resolveEffectiveSet` error — project not
 *      found, slot conflict, invalid tree) answers `unbound` with the fixed
 *      set-could-not-be-read sentence.
 * Then the deterministic matching rule documented in `packages/contract`
 * (`GUIDANCE_TOOLS`) picks the winner: the first match in
 * `resolveEffectiveSet`'s deterministic order wins; no match is a `miss`
 * whose one sentence includes the subject verbatim.
 *
 * No store or bundle read that fails throws: a failing identity, pointer or
 * pinned-bundle read answers `unbound` with the fixed run-did-not-complete
 * sentence. A mid-call bundle activation would otherwise quote one hash and
 * answer from another, so whenever the staleness read names a different
 * bundle than the payload served from, the call refuses in that same
 * sentence — the next call sees the new bundle consistently.
 *
 * Sentences are the fixed UX-DR29 constants from `@domain-harness/gate`;
 * only the per-tool miss templates are new constants of this unit (house
 * precedent). Nothing here logs, records or metricizes the subject: a tool
 * call of story 4.4 writes no row of its own.
 */
import type { GuidanceToolHit, GuidanceToolMiss, GuidanceToolName, GuidanceToolResult, StandardBundlePayload, StandardEntry, StandardInfo, UuidV7 } from "@domain-harness/contract";
import { isStandardBundlePayload } from "@domain-harness/contract";
import { entrySlot, normalizeSlotName, resolveEffectiveSet } from "@domain-harness/core";
import type { ConflictSlot, SlotHolder } from "@domain-harness/core";
import {
  BUNDLE_STALE,
  DUPLICATE_APPLICATION_ID,
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  RUN_DID_NOT_COMPLETE,
} from "@domain-harness/gate";
import { resolveGuidanceIdentity } from "./identity.ts";
import type { GuidanceIdentityHeaders, PinnedActiveBundle } from "./identity.ts";
import type { GuidanceIdentityStore } from "./store.ts";
import type { BundledStateOutcome } from "../bundles/puller.ts";

/**
 * The `unbound` reasons of this unit that no other surface shares. The
 * identity decision's own reasons pass through unchanged; `refused`
 * (a copied fingerprint) and `set_unreadable` are serving-side.
 */
export const SERVE_REFUSED_ORIGIN = "refused" as const;
export const SERVE_SET_UNREADABLE_ORIGIN = "set_unreadable" as const;

/** The reason for every failing store or bundle read (the run did not complete). */
export const SERVE_UNAVAILABLE_ORIGIN = "unavailable" as const;

/**
 * The per-tool miss sentence templates (UX-DR29: one fixed sentence that
 * includes the asked-for subject; new-reason constants live in the serving
 * unit). The stale case appends the fixed `bundle stale` sentence in
 * parentheses — still one sentence, still including the subject.
 */
export const MISS_SENTENCE_TEMPLATES: Readonly<Record<GuidanceToolName, (subject: string) => string>> = {
  code_stack_rule: (subject) => `the active bundle holds no code stack rule for ${subject}`,
  design_component: (subject) => `the active bundle holds no design component matching ${subject}`,
  design_token: (subject) => `the active bundle holds no design token named ${subject}`,
  design_import: (subject) => `the active bundle holds no design import covering ${subject}`,
};

/** Input of {@link serveGuidanceCall}. */
export interface ServeGuidanceCallInput {
  /** The identity headers of THIS HTTP request (the adapter re-reads them per request). */
  readonly headers: GuidanceIdentityHeaders;
  /** The tool being called; one of `GUIDANCE_TOOLS`. */
  readonly tool: GuidanceToolName;
  /** The asked subject, exactly as presented (a whitespace-only subject still reaches the unit). */
  readonly subject: string;
  readonly tenantId: UuidV7;
  /** The time of the call (UTC ISO-8601); feeds only the staleness bound. */
  readonly now: string;
  /** The guidance identity store of Story 4.3 (bindings, refusals, mismatches — its behavior is unchanged). */
  readonly identityStore: GuidanceIdentityStore;
  /**
   * The pinned active bundle through the bundles unit; `null` when none is
   * active. Read once per call and shared by the identity step, the
   * staleness comparison and the core resolution, so every step names the
   * same pinned bundle; never cached across calls.
   */
  readonly getPinnedBundle: (tenantId: UuidV7) => Promise<PinnedActiveBundle | null>;
  /** The staleness view through `bundledState`; a not-ok outcome is a failing store read. */
  readonly getBundledState: (now: string) => Promise<BundledStateOutcome>;
}

/**
 * Serve one Guidance tool call. Never throws; never writes a row of its own
 * (the miss/gap records are Story 4.5). The typed result is what the MCP
 * adapter serializes — `canonicalJson(result)` is the text the client sees.
 */
export async function serveGuidanceCall(input: ServeGuidanceCallInput): Promise<GuidanceToolResult> {
  try {
    return await decide(input);
  } catch {
    return { kind: "unbound", reason: SERVE_UNAVAILABLE_ORIGIN, sentence: RUN_DID_NOT_COMPLETE };
  }
}

async function decide(input: ServeGuidanceCallInput): Promise<GuidanceToolResult> {
  // The pinned-bundle read is shared by every step of THIS call only.
  let cached: Promise<PinnedActiveBundle | null> | undefined;
  const getPinnedBundleOnce = (tenantId: UuidV7): Promise<PinnedActiveBundle | null> => {
    if (tenantId !== input.tenantId) return input.getPinnedBundle(tenantId);
    // The raw read: a rejection surfaces as the identity unit's own
    // run-did-not-complete catch (4.3) during step 1, and as this unit's
    // never-throw catch during step 2 — a failing bundle read is never a
    // missing bundle.
    cached ??= input.getPinnedBundle(tenantId);
    return cached;
  };

  // (1) Identity first: 4.3's decision table, recorded rows unchanged.
  const identity = await resolveGuidanceIdentity({
    headers: input.headers,
    tenantId: input.tenantId,
    store: input.identityStore,
    getPinnedBundle: getPinnedBundleOnce,
  });
  if (identity.kind === "unbound") {
    return { kind: "unbound", reason: identity.reason, sentence: identity.sentence };
  }
  if (identity.kind === "refused") {
    return { kind: "unbound", reason: SERVE_REFUSED_ORIGIN, sentence: DUPLICATE_APPLICATION_ID };
  }

  // (2) Staleness through `bundledState`: past the bound and not frozen.
  const state = await input.getBundledState(input.now);
  if (!state.ok) {
    // An invalid active bundle is an unreadable set (UX-DR29's fixed
    // sentence); no pointer or a pointer naming a missing bundle is a
    // failing store read — the run did not complete.
    if (state.reason === "active_bundle_invalid") {
      return { kind: "unbound", reason: SERVE_SET_UNREADABLE_ORIGIN, sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ };
    }
    return { kind: "unbound", reason: SERVE_UNAVAILABLE_ORIGIN, sentence: RUN_DID_NOT_COMPLETE };
  }
  const pinned = await getPinnedBundleOnce(input.tenantId);
  if (pinned === null || !isStandardBundlePayload(pinned.payload)) {
    // A bundle that vanished under the call, or an invalid payload: the
    // set cannot be read.
    return { kind: "unbound", reason: SERVE_SET_UNREADABLE_ORIGIN, sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ };
  }
  if (state.state.hash !== pinned.hash) {
    // A mid-call activation: quoting one hash and answering from another
    // would mislead the agent, so the call does not complete; the next call
    // reads the new bundle consistently.
    return { kind: "unbound", reason: SERVE_UNAVAILABLE_ORIGIN, sentence: RUN_DID_NOT_COMPLETE };
  }
  const stale = state.state.stale;

  // (3) The Effective Standard set ONLY from the bundle payload, through core.
  const resolution = resolveEffectiveSet(effectiveSetInputOf(pinned.payload, identity.projectId));
  if (!resolution.ok) {
    return { kind: "unbound", reason: SERVE_SET_UNREADABLE_ORIGIN, sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ };
  }

  const standardsById = new Map<string, StandardInfo>(pinned.payload.standards.map((standard) => [standard.id as string, standard]));
  const tool = input.tool;
  for (const effective of resolution.set) {
    const standard = standardsById.get(effective.standardId);
    if (standard === undefined || !matches(tool, input.subject, effective.slot, standard.entry)) {
      continue;
    }
    // The first match in `resolveEffectiveSet`'s deterministic order wins.
    const hit: GuidanceToolHit = {
      kind: "hit",
      tool,
      subject: input.subject,
      standardId: standard.id,
      version: standard.version,
      content: hitContentOf(standard.entry, stale),
      bundleHash: pinned.hash,
      stale,
    };
    return hit;
  }
  const miss: GuidanceToolMiss = {
    kind: "miss",
    tool,
    subject: input.subject,
    sentence: missSentenceOf(tool, input.subject, stale),
    bundleHash: pinned.hash,
    stale,
  };
  return miss;
}

/** The miss sentence: the per-tool template including the subject; `bundle stale` appended when stale. */
export function missSentenceOf(tool: GuidanceToolName, subject: string, stale: boolean): string {
  const sentence = MISS_SENTENCE_TEMPLATES[tool](subject);
  return stale ? `${sentence} (${BUNDLE_STALE})` : sentence;
}

/** `resolveEffectiveSet`'s inputs, derived only from the bundle payload; the Project comes from the identity step. */
function effectiveSetInputOf(payload: StandardBundlePayload, projectId: string) {
  const holders: SlotHolder[] = payload.standards.map((standard) => ({
    standardId: standard.id,
    projectId: standard.project.id,
    slot: entrySlot(standard.entry),
  }));
  return {
    projects: payload.tree.projects.map((project) => ({ id: project.id, parentId: project.parentId })),
    standards: holders,
    // Locked ids deduplicated by `standardId`, in payload order.
    lockedStandardIds: [...new Set(payload.tree.lockedRules.map((mark) => mark.standardId))],
    projectId,
  };
}

/**
 * The deterministic matching rule of `packages/contract` (next to
 * GUIDANCE_TOOLS): casefold — trim, NFC, lowercase — against the winning
 * set's slot names, `design_component` falling back to containment in a
 * component's casefolded `usageRule`.
 */
function matches(tool: GuidanceToolName, subject: string, slot: ConflictSlot, entry: StandardEntry): boolean {
  const asked = normalizeSlotName(subject);
  // A blank subject casefolds to ""; matching nothing is what the matrix
  // pins (a miss), not the first component whose usage rule contains "".
  if (asked === "") {
    return false;
  }
  if (tool === "code_stack_rule") {
    return slot.moduleKind === "code-stack" && normalizeSlotName(slot.name) === asked;
  }
  const expectedKind = tool === "design_component" ? "component" : tool === "design_token" ? "token" : "import";
  if (slot.moduleKind !== "design-system" || slot.slotKind !== expectedKind) {
    return false;
  }
  if (normalizeSlotName(slot.name) === asked) {
    return true;
  }
  // `design_component`'s second rule: the casefolded subject occurs inside a
  // component's casefolded usage rule; no other tool falls back.
  return tool === "design_component" && "kind" in entry && entry.kind === "component" && normalizeSlotName(entry.usageRule).includes(asked);
}

/**
 * The deterministic hit content: one text rendering of the live entry's
 * fields (what it requires, allows or prohibits; a component's usage rule
 * and tokens; a code-stack entry's constraint); `bundle stale` when the
 * pinned bundle is past its bound and not frozen; the Correction line last
 * when the entry carries one.
 */
function hitContentOf(entry: StandardEntry, stale: boolean): string {
  const lines = [renderEntry(entry)];
  if (stale) lines.push(BUNDLE_STALE);
  // Only code-stack entries and components carry a Correction instruction.
  if ("correctionInstruction" in entry && entry.correctionInstruction !== null) {
    lines.push(`Correction: ${entry.correctionInstruction}`);
  }
  return lines.join("\n");
}

/** One rendering per entry shape, built only from the entry's stored fields. */
function renderEntry(entry: StandardEntry): string {
  if (!("kind" in entry)) {
    const constraint = entry.versionConstraint === null ? "" : ` (version constraint: ${entry.versionConstraint})`;
    return `The ${entry.category} ${entry.name}${constraint} is ${entry.status}.`;
  }
  switch (entry.kind) {
    case "component": {
      const tokens = entry.tokens.length === 0 ? "" : ` It depends on the tokens: ${entry.tokens.join(", ")}.`;
      return `The component ${entry.name} is governed by this usage rule: ${entry.usageRule}${tokens}`;
    }
    case "token":
      return `The design token ${entry.name} is ${entry.status}.`;
    case "import":
      return `The import of ${entry.specifier} is ${entry.status}.`;
  }
}
