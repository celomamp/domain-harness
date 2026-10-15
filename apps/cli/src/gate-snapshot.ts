/**
 * Wire-bundle to Gate-snapshot adaptation (Story 8.2): pure glue that turns
 * 8.1's verified `SignedStandardBundle` into the `GateBundleSnapshot` the
 * shared `runGateDirect` adapter evaluates.
 *
 * Service-identical semantics:
 * - `hash` is 8.1's verified hash; `issuedAt` is `payload.issuedAt`.
 * - `applications` are the payload application ids.
 * - `accepted` is `payload.acceptedDeviations`.
 * - `stalenessBoundHours` is `payload.stalenessHours`.
 * - `frozen: true` maps to `frozenUntil` covering the run (the run clock),
 *   `frozen: false` maps to `null`.
 * - The Effective Standard set resolves only through `core`
 *   (`resolveEffectiveSet` with holders from `entrySlot`, locked ids from
 *   `tree.lockedRules`, project id from the bundle's application entry for
 *   the identification file's Application id); winners hydrate from the
 *   payload's own `StandardInfo` records in `core`'s order. Nothing is
 *   re-sorted, filtered, or re-implemented.
 *
 * Pure: no I/O, no clock reads, no network. Never throws. Unknown
 * application id yields `unbound`; resolution failure yields
 * `set-unreadable`; both carry the exact shared sentence with exit 1.
 */
import type { SignedStandardBundle, StandardInfo } from "@domain-harness/contract";
import { entrySlot, resolveEffectiveSet } from "@domain-harness/core";
import type { SlotHolder } from "@domain-harness/core";
import {
  EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
  UNBOUND,
} from "@domain-harness/gate";
import type { GateBundleSnapshot } from "@domain-harness/gate";

/** Input of {@link adaptWireBundleToSnapshot}. */
export interface AdaptWireBundleInput {
  readonly signed: SignedStandardBundle;
  /** 8.1's verified hash (SHA-256 hex of the canonical signed bytes). */
  readonly hash: string;
  /** Application id from the identification file. */
  readonly applicationId: string;
  /** Run-clock ISO string (the `--now` value or the current time). */
  readonly now: string;
}

/** Outcome of {@link adaptWireBundleToSnapshot}. Never throws. */
export type AdaptWireBundleOutcome =
  | { readonly ok: true; readonly snapshot: GateBundleSnapshot }
  | {
      readonly ok: false;
      readonly reason: "unbound" | "set-unreadable";
      readonly sentence:
        | typeof UNBOUND
        | typeof EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ;
      readonly exitCode: 1;
    };

function unbound(): AdaptWireBundleOutcome {
  return { ok: false, reason: "unbound", sentence: UNBOUND, exitCode: 1 };
}

function setUnreadable(): AdaptWireBundleOutcome {
  return {
    ok: false,
    reason: "set-unreadable",
    sentence: EFFECTIVE_STANDARD_SET_COULD_NOT_BE_READ,
    exitCode: 1,
  };
}

/**
 * Adapt a verified wire bundle into a Gate snapshot for one Application.
 * Never throws. The gate never evaluates an unverified bundle — callers run
 * 8.1's `loadBundleFile` first and pass only its verified output here.
 */
export function adaptWireBundleToSnapshot(
  input: AdaptWireBundleInput,
): AdaptWireBundleOutcome {
  try {
    const signedRecord: unknown = input.signed;
    const hash = input.hash;
    const applicationId = input.applicationId;
    const now = input.now;
    if (
      typeof signedRecord !== "object" ||
      signedRecord === null ||
      typeof hash !== "string" ||
      hash === "" ||
      typeof applicationId !== "string" ||
      applicationId === "" ||
      typeof now !== "string" ||
      now === ""
    ) {
      return setUnreadable();
    }
    const signed = signedRecord as SignedStandardBundle;
    const payloadRecord: unknown = signed.payload;
    if (
      typeof payloadRecord !== "object" ||
      payloadRecord === null ||
      !Array.isArray(
        (payloadRecord as { applications?: unknown }).applications,
      ) ||
      !Array.isArray(
        (payloadRecord as { standards?: unknown }).standards,
      )
    ) {
      return setUnreadable();
    }
    const payload = payloadRecord as SignedStandardBundle["payload"];

    const entry = payload.applications.find(
      (candidate) => candidate.id === applicationId,
    );
    if (entry === undefined) return unbound();
    const projectId = entry.projectId;

    let holders: SlotHolder[];
    try {
      holders = payload.standards.map((standard) => ({
        standardId: standard.id,
        projectId: standard.project.id,
        slot: entrySlot(standard.entry),
      }));
    } catch {
      return setUnreadable();
    }

    let projects: ReadonlyArray<{ id: string; parentId: string | null }>;
    try {
      projects = payload.tree.projects.map((project) => ({
        id: project.id,
        parentId: project.parentId,
      }));
    } catch {
      return setUnreadable();
    }

    let lockedStandardIds: string[];
    try {
      lockedStandardIds = [
        ...new Set(payload.tree.lockedRules.map((mark) => mark.standardId)),
      ];
    } catch {
      return setUnreadable();
    }

    const resolution = resolveEffectiveSet({
      projects,
      standards: holders,
      lockedStandardIds,
      projectId,
    });
    if (!resolution.ok) return setUnreadable();

    const byId = new Map<string, StandardInfo>(
      payload.standards.map((standard) => [standard.id, standard]),
    );

    const treeProject = payload.tree.projects.find(
      (project) => project.id === projectId,
    );
    if (treeProject === undefined) return setUnreadable();
    const projectRef = { id: treeProject.id, name: treeProject.name };

    const hydrated: Array<GateBundleSnapshot["effectiveSet"]["standards"][number]> = [];
    for (const winner of resolution.set) {
      const standard = byId.get(winner.standardId);
      if (standard === undefined) return setUnreadable();
      const record = standard.entry as unknown as Record<string, unknown>;
      const isComponent =
        typeof record["kind"] === "string" && record["kind"] === "component";
      const status = isComponent
        ? null
        : (record["status"] as
            | GateBundleSnapshot["effectiveSet"]["standards"][number]["status"]);
      if (!isComponent && typeof status !== "string") return setUnreadable();
      hydrated.push({
        slot: {
          moduleKind: winner.slot.moduleKind,
          slotKind: winner.slot.slotKind,
          name: winner.slot.name,
        },
        status,
        standard,
        sourceProject: {
          id: standard.project.id,
          name: standard.project.name,
        },
        locked: winner.locked,
      });
    }

    const snapshot: GateBundleSnapshot = {
      hash,
      issuedAt: payload.issuedAt,
      applications: payload.applications.map((item) => item.id),
      effectiveSet: { project: projectRef, standards: hydrated },
      accepted: payload.acceptedDeviations,
      stalenessBoundHours: payload.stalenessHours,
      frozenUntil: payload.frozen ? now : null,
    };
    return { ok: true, snapshot };
  } catch {
    return setUnreadable();
  }
}
