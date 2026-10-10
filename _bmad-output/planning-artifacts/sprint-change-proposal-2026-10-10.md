---
status: draft
date: 2026-10-10
trigger: 'Implementation readiness gate returned CONCERNS (implementation-readiness.md)'
mode: batch
scope: Minor
---

# Sprint Change Proposal — Readiness gaps before sprint planning

## 1. Issue Summary

The readiness gate before sprint planning returned **CONCERNS**. Six decisions that stories rely on were recorded only in story text, or nowhere: call identity, Guidance-record reads, pilot stack, pilot CI, two Application capabilities, and sign-in plus settings placement. No code exists yet; the issue was found at planning time. Marcelo supplied the decisions on 2026-10-10: TypeScript/npm only, GitHub Actions, magic-link sign-in, and header-based call identity.

**Issue type:** misunderstanding/omission in the planning record (no pivot, no new market requirement).

## 2. Impact Analysis

| Area | Impact |
|---|---|
| Epics | No epic is added, removed or reordered. Epics 1, 3, 4, 5 and 6 get acceptance-criteria edits. |
| Stories | 1.3, 3.1, 3.3, 3.5, 4.1, 4.3, 5.1, 5.3, 6.7 (text edits). No new story. |
| PRD | No change. SPEC takes precedence over the PRD and records the additions (§4.1). |
| SPEC | Constraints and CAP-3, CAP-4, CAP-13 amended. |
| Architecture Spine | AD-19 amended. New AD-22 (Guidance-record reads stay in the Company environment). Stack table amended. |
| EXPERIENCE | Sign-in, Guidance access, Application states, New-application flow, Standards, open gaps. |
| Technical | None yet (no code). One design finding, F-1 below, changes how the identity headers are produced. |

### Finding F-1 (decision needed): the fingerprint cannot be baked into the Boilerplate

The accepted rule is "the MCP configuration sends the Application id and a repository fingerprint as HTTP headers; fingerprint = hash of the root commit plus the remote URL". Two facts break a static configuration:

1. **The Boilerplate is an archive.** The repository's root commit does not exist when the registry generates the MCP configuration, so the fingerprint cannot be written into it.
2. **The remote URL is usually absent at the climax.** In UJ-2, Ana opens the repository in her agent right away, typically before adding a remote or pushing. If the remote URL is part of the fingerprint, the first binding happens without it. Adding the remote later changes the fingerprint, and the Application is then refused as "already bound to another repository".

**Proposed resolution (recommended):**
- **Compute the headers at call time, not at generation time.** The Boilerplate ships a tiny stdio MCP bridge (`@domain-harness/mcp-bridge`, run via `npx`) as the MCP server entry for both Claude Code and Cursor. On each session it reads the identification file and `git rev-list --max-parents=0 HEAD`, then forwards to the Company service over Streamable HTTP with the headers `X-DH-Application-Id` and `X-DH-Repo-Fingerprint`. This works in every MCP client (stdio is universal), and no vendor hook is involved.
- **Fingerprint = SHA-256 of the root commit SHA only.** Drop the remote URL. A fork or clone shares the root commit and would be accepted. Under the pilot's network-trust model (AD-19) that is an accepted risk, and per-Application tokens remain the deferred hardening path.
- **No commit yet means `unbound`.** If the repository has no commit, the bridge sends no fingerprint and the service returns `unbound` with one sentence: "commit once, then retry". The skills file tells the agent to make an initial commit first.
- **CI and CLI compute the same fingerprint** from the checked-out repository.

**Alternative:** keep root commit + remote URL, and bind only on the first call that presents a remote. Guidance before the first push then returns `unbound`, which breaks the UJ-2 climax. Not recommended.

## 3. Recommended Approach

**Direct Adjustment.** Edit the planning documents and the affected stories; there is no rollback (nothing is built) and no MVP change.
- Effort: Low. Risk: Low.
- Timeline impact: none. Sprint planning reruns right after.

## 4. Detailed Change Proposals

### 4.1 SPEC (`_bmad-output/specs/spec-domain-harness/SPEC.md`)

**CAP-3, success — append:**
> Placing an Application requires a per-Project build grant from the Buyer (FR-8 "allowed to build there"). The Buyer can also register an existing Application (id and identification file only, no Boilerplate, flagged not-from-flow) so it can run the Gate and form the FR-23 baseline set.

**CAP-4, success — append:**
> Every surface reads the identity the same way: Application id from the identification file, repository fingerprint = SHA-256 of the root commit SHA. Guidance receives both as `X-DH-Application-Id` / `X-DH-Repo-Fingerprint` headers from the Boilerplate's stdio MCP bridge, computed at call time. A repository with no commit is `unbound`.

**CAP-13, success — append:**
> Stored Guidance-event content is readable only through the Company service's read endpoint, with a registry-issued role token. The management panel never holds or renders that content; it shows Compilation-derived evidence and the role-grant configuration.

**Constraints — add "Pilot facts (2026-10-10)":**
> The pilot Company builds only in TypeScript/npm, so the Boilerplate generator and the extractor support only that ecosystem. The pilot CI is GitHub, and the CI Gate ships as a GitHub Action. Panel sign-in is a passwordless magic link: a single-use link with a short expiry, sent to a provisioned account's email. There are no passwords, and SSO stays out.

**Constraints, "Identity" — replace:**
> OLD: Network trust plus repository fingerprint (AD-19) is the pilot's identity model.
> NEW: Network trust plus repository fingerprint (AD-19: root-commit hash, sent as headers by the stdio bridge) is the pilot's identity model. Forks sharing a root commit are an accepted pilot risk.

### 4.2 Architecture Spine (`ARCHITECTURE-SPINE.md`)

**AD-19 — Rule, replace the second sentence onward:**
> The Application id comes from the identification file. The repository fingerprint is SHA-256 of the root commit SHA (`git rev-list --max-parents=0 HEAD`); the remote URL is not used. Guidance receives both as `X-DH-Application-Id` and `X-DH-Repo-Fingerprint` headers. They are computed at call time by a stdio MCP bridge shipped in the Boilerplate (`@domain-harness/mcp-bridge`), which forwards to the service over Streamable HTTP. The CI step and the CLI compute the same values. Header names and the fingerprint algorithm are versioned in `contract`. On first use the service (or the CLI's local file) binds the id to the fingerprint, and a different fingerprint presenting a bound id is refused as a Compilation-visible refusal. A repository with no commit yields `unbound`. Forks share a root commit; this is an accepted pilot risk. Per-Application tokens are a hardening path (Deferred).

**New AD-22 — Guidance-record reads stay in the Company environment [ADOPTED]:**
> - **Binds:** FR-20, FR-26, FR-28, NFR-9
> - **Prevents:** The panel growing a path to Company-held Guidance content, and the role check living in two places.
> - **Rule:** Stored Guidance-event content is read only through a Company service endpoint inside the Company network. The endpoint requires a short-lived, tenant-scoped role token issued by the registry (AD-17), whose role holds the Buyer's FR-28 grant. The panel configures the grant and shows Compilation-derived evidence only. It never proxies, caches or renders Guidance content. Retention (default 90 days, Company-configurable) is enforced by the service on its own store.

**Stack table — add rows:**
> | CI Gate target | GitHub Actions (pilot) |
> | Panel sign-in | Passwordless magic link (email delivery provider chosen at scaffold) |

**Capability map — "Access" row:** add AD-22.

### 4.3 EXPERIENCE (`EXPERIENCE.md`)

- **Foundation, sign-in assumption — replace:**
  > Sign-in is a passwordless magic link sent to a provisioned account's email. SSO is outside the first cut.
- **sign-in component — replace the behavioral rules:**
  > A single email field. Submitting a provisioned address shows "Check your email for a sign-in link" in text. Submitting an unprovisioned address shows the same text, so the form never reveals whether an account exists. The link is single-use and expires after a short period. An expired or used link lands on sign-in with a denial in text. Success lands on Inventory.
- **Guidance access row (IA) and role-grant component — append:**
  > Guidance-event content is read inside the Company environment through the Company service, not on the management panel. The panel configures which roles hold the grant and shows the retention setting (default 90 days).
- **Application states, Permission-denied — replace:**
  > OLD: denial on Guidance event content when the role lacks the grant.
  > NEW: The panel shows whether Guidance was consulted (from Compilations), never Guidance content. Content is read in the Company environment, where a role without the grant receives a denial.
- **New-application flow (IA purpose) — append:**
  > The Buyer also sets the Company Guidance endpoint URL here, and registers an existing Application (identification file only, no Boilerplate). A Builder places Applications only on Projects where the Buyer granted building.
- **Standards (IA purpose) — append:**
  > The Buyer sets the staleness bound (default 24 hours) and records or lifts a freeze here. bundle-status on Compilations shows the result.
- **Application states, Failure — append:**
  > A repository with no commit returns unbound Application, and the text says to commit once and retry.
- **Open gaps:** remove "Authentication mechanism"; add "Email delivery provider for magic links".

### 4.4 Stories (`epics.md`)

| Story | Section | Change |
|---|---|---|
| 1.3 | AC, sign-in | "mechanism chosen at implementation" becomes magic link. New ACs: link-sent text identical for unknown emails; single-use, expiring link; expired or used link gives a denial on sign-in. |
| 3.1 | AC | Cite the SPEC CAP-3 build grant (wording otherwise unchanged). |
| 3.3 | AC, MCP config | The MCP configuration declares the stdio bridge as the Domain Harness server, with the endpoint URL as its argument. Skills tell the agent to make an initial commit before calling Guidance. "Only npm/TypeScript supported" now cites the pilot fact. |
| 3.4 | AC | Cursor config uses the same stdio bridge entry. |
| 3.5 | AC | Cite SPEC CAP-3 (unchanged otherwise). |
| 4.1 | AC | Unchanged. The bound and freeze sit on the Standards surface, now recorded in EXPERIENCE. |
| 4.3 | AC | Replace "a mechanism defined in `contract`" with: the bridge package `@domain-harness/mcp-bridge` and the headers; fingerprint = SHA-256(root commit SHA); a repository with no commit returns `unbound` with the commit-once sentence; Boilerplates from Epic 3 need no regeneration, because the bridge computes values at runtime. |
| 5.1 | AC | Cite the pilot fact for npm/TS only (unchanged otherwise). |
| 5.3 | AC | "a generic container or script usable from any CI, with the GitHub Actions wrapper first" becomes "a GitHub Action (the pilot CI)". The fingerprint is computed per AD-19. |
| 6.7 | AC | Cite AD-22. The read endpoint lives in the Company service, and the panel shows no Guidance content. |

### 4.5 Readiness record

`implementation-readiness.md` changes to `status: resolved`, with each concern pointing to the edit above.

## 5. Implementation Handoff

- **Scope:** Minor. Planning-document edits only, applied in this session.
- **Recipient:** the Developer agent (Amelia) builds against the updated documents. Sprint planning reruns immediately after.
- **Success criteria:** the readiness gate returns PASS, and `sprint-status.yaml` is generated.
