# Epic 8 Context: A Builder runs the Gate offline before pushing

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give Builders a free, fully offline Community CLI Gate that checks a local revision against the same trusted Standards as the CI Gate before pushing. The CLI verifies a downloaded bundle file with the service's exact checks, keeps a local binding file, runs the same core and extractor in process, prints the same Deviations and host sentences with the same exit codes, applies the staleness bound to the bundle's issue time, and never touches the working tree. It ships only if it does not delay the pilot.

## Stories

- Story 8.1: Load and verify a bundle file offline
- Story 8.2: Run the Gate locally with the same result as CI
- Story 8.3: Distribute the CLI

## Requirements & Constraints

- **Offline bundle file:** the Buyer downloads the current bundle file and the trust set; the CLI loads both from paths with no network (AD-8, FR-13).
- **Same verification as the service:** signature, key id in the trust set, tenant match, hash re-derivation, and sequence against the last one seen locally; any failure prints one sentence and exits non-zero.
- **Stale rule on issue time:** a bundle whose issue time is past the Buyer-set bound (default 24h) with no freeze prints the stale sentence and exits non-zero.
- **Same Gate result as CI:** for the same revision and bundle, the CLI prints each Deviation with its Standard id and Correction instruction, exits non-zero on any open Deviation, and exits zero only when every Deviation is absent or accepted and unexpired (NFR-1).
- **Local binding:** the Application id ↔ repository fingerprint binding lives in a local file; first use binds, a different fingerprint presenting a bound id is refused in one sentence, and missing, unreadable or unbound identification files each print their sentence and exit non-zero (FR-10).
- **Fail closed, never silent:** every refusal above is an explicit non-zero exit, never an empty pass (NFR-5).
- **Pristine tree:** no run modifies the working tree or the commit.
- **Free Community scope:** single Project; unknown bundle major versions are refused in one sentence with a non-zero exit.
- **Distribution:** one-command npm install; `--version` prints the CLI, extractor, fact-schema and contract versions.

## Technical Decisions

- The CLI lives in `apps/cli` and runs the same `packages/core` evaluator and `packages/extractor` revision facts as the CI path; no adapter re-implements or post-processes resolution output (AD-1, AD-5, AD-6, AD-18).
- The bundle format, canonical serialization, guards and host sentences are defined once in `packages/contract` (bundle identity) and `packages/gate` (shared sentences, canonical result, deterministic fixture suite from story 5.4); the CLI reuses them and re-implements only the small hash/verify primitives from `contract` plus `node:crypto`, since cross-app imports are forbidden (story 4.2 set the precedent).
- Signature rule mirrors the registry exactly: Ed25519 (base64) over the canonical bytes of the payload; hash is SHA-256 hex of the canonical bytes of the whole signed object; the payload carries tenant id, per-tenant monotonic sequence and key id (AD-11).
- Trust arrives as a local file (key id → public key); rotation overlaps by key id. Time is an input: the adapter supplies the run clock, the core never reads one (AD-7).
- A Gate result stays a pure function of (revision facts, extractor version, bundle hash, clock input); the story 5.4 fixture suite is reused unchanged through the CLI adapter to prove CLI/CI parity.

## UX & Interaction Patterns

- Host text contract: pass, fail, unbound Application, missing or unreadable identification file, duplicate Application id, run did not complete, Effective Standard set could not be read, bundle stale, and bundle verification failed each print exactly one fixed sentence; a miss-style sentence is not part of this surface. Host output never names a plan.
- Each Deviation line shows its Standard id and Correction instruction; the exit code carries the verdict (zero only on clean or fully accepted-unexpired).

## Cross-Story Dependencies

- From Epic 4: bundle format, signing rule, trust-set shape, tenant/sequence semantics, staleness bound and freeze, and the identification/binding fingerprint rule the CLI mirrors locally.
- From Epic 5: core evaluator, extractor facts, shared gate sentences, and the deterministic fixture suite the CLI reuses to prove parity.
- From Epic 3: the identification file format the CLI reads to resolve the Application id.
- Within this epic: bundle load/verify (8.1) feeds the local Gate run (8.2); distribution (8.3) ships both.
