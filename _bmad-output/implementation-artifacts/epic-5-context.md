# Epic 5 Context: The pipeline stops non-compliant code, and the Buyer may accept a Deviation

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic makes the Company's pipeline enforce its Standards before code reaches production, while giving the Buyer a controlled, time-boxed way to let a known exception through. It builds the deterministic fact extractor, the core Deviation evaluator, the CI Gate step, and the Accepted-deviation flow with recurring alerts.

## Stories

- Story 5.1: Extract revision facts deterministically
- Story 5.2: Evaluate Deviations in the core
- Story 5.3: Run the CI Gate as a pipeline step
- Story 5.4: Prove Gate determinism across adapters
- Story 5.5: Buyer records an Accepted deviation
- Story 5.6: Buyer receives recurring alerts for Accepted deviations

## Requirements & Constraints

- The Gate evaluates code-stack entries (prohibited/required libraries, frameworks, languages, version constraints) and design-system entries (component allow-list, required/prohibited tokens, required/prohibited imports). It does not score visual fidelity.
- A Deviation is emitted for each prohibited match, each missing required entry, each version-constraint violation, and each component outside the allow-list. Each Deviation carries the Standard id, conflict slot, subject, and a Correction instruction.
- The CI Gate runs as a step in the Company's existing GitHub Actions pipeline. It fails the pipeline exactly when an open Deviation exists or when a refusal condition occurs; otherwise it exits zero.
- Refusal conditions fail closed: missing or unreadable identification file, unbound Application id, duplicate Application id bound to another repository, unreadable Effective Standard set, stale bundle past the Buyer-set bound (default 24h), or a run that did not complete.
- The Gate never modifies the working tree or the commit that enters the step.
- The Buyer can record an Accepted deviation with a justification, start, end, and alert interval. Acceptance is keyed to (Application id, Standard id, Standard version, conflict slot, subject). While unexpired, only that exact key passes; after the end date the same finding fails again with no new bundle. Builders cannot accept their own Deviations.
- Recurring alerts name the Application, Standard, and end date, and are evaluated and delivered by the registry, not the Company service.
- Gate runs are stored against the Application id and include the revision, pinned bundle hash, extractor version, Deviations, and checked/open counts.
- The CI Gate target completion time is under 60 seconds for a reference revision.

## Technical Decisions

- Revision-fact extraction lives only in `packages/extractor`. It is a deterministic function of supplied file contents, emits a versioned fact schema, and records its version on every Gate run. It parses npm manifests and lockfiles, TS/JS import specifiers, and design-token references.
- Deviation evaluation and Effective-set resolution live only in `packages/core`. No adapter re-implements or post-processes the result.
- A Gate result is a pure function of (revision facts, extractor version, bundle hash, clock input). The core never reads a clock; the adapter supplies the run time for acceptance expiry and staleness checks.
- The CI Gate step runs inside `apps/service` (the Company-operated service), pins the active bundle hash at start, and records that hash with the run. A bundle activated mid-run is not used.
- The service marks itself stale when the active bundle age passes the bound and no freeze is recorded; the CI step then fails with a single stale sentence.
- The CI step uses the same Application binding and repository-fingerprint rules as Guidance: the Application id comes from the identification file, the fingerprint is SHA-256 of the root commit SHA, and a different fingerprint presenting a bound id is refused and recorded as a Binding refusal.
- Package boundary rules enforced by tooling: `packages/extractor` imports only `contract`; `apps/service` imports `core`, `extractor`, and `contract`.

## UX & Interaction Patterns

- CI step log output follows the host text contract: one fixed sentence for pass, fail, unbound Application, missing/unreadable identification file, duplicate Application id, run did not complete, Effective Standard set could not be read, bundle stale, and bundle verification failed. Each Deviation line shows the Standard id and one Correction instruction naming a compliant alternative.
- On the panel, the Accepted-deviation surface lets the Buyer paste a CI log line or enter the match key, then fill justification, start, end, and alert interval. An end before the start is an invalid submit that names the end field. A Builder attempting acceptance gets a denial stating the Buyer records acceptance.
- The accepted-deviation-alert is a gold band under the panel chrome naming the Application, Standard, and end date. It stays until dismissed or the end date passes, and respects motion/pause rules.
- The Deviation row and correction-instruction use the panel row language: cream inset for the instruction, status shown as text ("open"/"accepted"), no green or red fills.
- Accepted deviation and CI Gate are Team-plan capabilities; Community plan shows a plan-refusal naming Team (first sale) with no price.

## Cross-Story Dependencies

- Story 5.1 must deliver the extractor and fact schema before 5.2/5.3 can evaluate Deviations.
- Story 5.2 must deliver the core evaluator before 5.3/5.4 can run or prove the Gate.
- Story 5.3 depends on the bundle pull/verify/activate flow (Epic 4) and the identification file (Epic 3).
- Story 5.5/5.6 depend on the registry's append-only acceptance store and alert scheduler, and on the Project/Application data carried in the bundle.
- Story 5.4's fixture suite is reused by Epic 8 (CLI Gate); keep the adapter boundary clean so the CLI can run the same suite unchanged.
