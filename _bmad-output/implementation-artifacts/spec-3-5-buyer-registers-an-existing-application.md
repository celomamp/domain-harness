---
title: 'Story 3.5: Buyer registers an existing Application'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '6061af063682746c00611a34815f76f6628aaa89'
review_loop_iteration: 0
followup_review_recommended: falsecontext:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-generate-a-boilerplate-for-claude-code.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Only the New-application flow can create an Application, so an Application that already exists in the Company's repositories cannot run the Gate and cannot form the FR-23 baseline set that the pilot's adherence metric compares against (FR-10, Story 3.5).

**Approach:** Add a Buyer-only registry endpoint `POST /v1/applications/registered` that creates an Application from the same description + Project body, sets `fromFlow: false` and returns **only** the rendered Project identification file to commit — no Boilerplate, no archive. The panel's New-application flow surface gains a "Register an existing Application" form that shows that file.

## Boundaries & Constraints

**Always:**
- **Contract** (`packages/contract/src/applications.ts`): `APPLICATION_API_PATHS` gains `registered: "/v1/applications/registered"`, documented as: `POST` an `ApplicationCreateRequest` → 201 `IdentificationFileRendering` (the Buyer only; any other role `role_denied`). The request body and the response reuse the existing `ApplicationCreateRequest` and `IdentificationFileRendering` shapes — no new types, no guard changes (`isIdentificationFileRendering` already guards the response). This adds no contract import cycle.
- **Service** (`apps/registry/src/applications/service.ts`): new exported `registerApplication(db, session, body)` sharing `createApplication`'s check order, first failure wins and nothing written: role → body → Project → core. Role first: `session.role !== "Buyer"` → 403 `role_denied`, subject `role`, message ending "; nothing was created" (copy the `assertGuidanceEndpointBuyer` shape from `guidance-endpoint/service.ts:13-21`). Then the shared body/Project/core/insert path with `createApplication`, factored into one private helper (mint `mintUuidV7()`, `validateBundleInput` with the new `ApplicationNode` added to the live rows, insert with `fromFlow: false` and `createdBy: session.accountId`); `createApplication` keeps its grant check between the Project check and the helper call. On success return `{ fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(id, projectId) }`.
- **HTTP** (`apps/registry/src/http/server.ts`): `ROUTES` gains the registration route with `["POST"]` (exact static path — no param-regex entry needed; `matchRoute` resolves it before `PARAM_ROUTES`). Handler case mirrors the Guidance endpoint: session, then `requireBuyer(req, session, assertApplicationBuyer)` **before** `readJson` (the body is drained, never parsed, for a non-Buyer), then 201 with `services.applications.registerApplication(session, body)`. Add a Buyer-only `assertApplicationBuyer` in the applications service next to `registerApplication` (used both by `requireBuyer` and as the service's own guard).
- **Panel client** (`apps/panel/src/registry.server.ts`): `registerApplication(sessionToken, input)` — `call(APPLICATION_API_PATHS.registered, json(body, bearer(sessionToken)), 201, isIdentificationFileRendering)`.
- **Panel surface** (`apps/panel/src/components/new-application.tsx` + `src/routes/new-application.tsx`): `NewApplicationIntent` gains `"register"`; the New-application flow page gains a "Register an existing Application" form section (Description textarea + Project field + secondary button — gold stays on the place form's primary action) shown to **every role** (controls are never hidden by role); a refused submit keeps the submitted values and puts ink text under the offending field; a success renders a raised result section that names the file and shows its exact content, with text telling the Buyer to commit it to the repository root and noting no Boilerplate is generated. Reuse the `boilerplate-result` raised-surface pattern and the existing `Status`/`FieldError` components. The registry checks role before the body, so the route's register action maps `ROLE_DENIED` → 403 denial (the `endpointAction` pattern), `invalid_input` subjects → field ink, `PROJECT_NOT_FOUND` → denial, anything else → 503 unavailable.
- **Registration writes nothing beyond the `applications` row**: no `application_agent_tool_changes` row (the list answers `agentTool: null`), no Boilerplate, no guidance-endpoint read, no migration.

**Never:**
- No new migration, no schema change (`applications.from_flow` already exists).
- No change to the existing `POST /v1/applications` placement path, its roles or its responses; no change to `ApplicationInfo`, `isApplicationInfo` or the identification-file GET.
- No Boilerplate generation, archive, MCP configuration or agent-tool recording for a registered Application.
- No role-based hiding of the register form in the panel; the denial is announced as a status.
- No new npm dependency; no YAML; no hooks or `settings` paths anywhere.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buyer happy path | Buyer session; valid `{ description, projectId }` | 201 `IdentificationFileRendering`; the row exists with `fromFlow: false`; the list shows it with `agentTool: null`; the content is byte-identical to `formatIdentificationFile` of the minted id and the Project id (and to `GET /v1/applications/{id}/identification-file`) | none |
| Builder tries | Builder session, any body | 403 `role_denied`, subject `role`, **before the body is read** (even a non-JSON or oversized body) | none |
| Standard owner tries | Standard-owner session, any body | 403 `role_denied`, subject `role` | none |
| Invalid body | Buyer; extra key, missing/overlong description or missing projectId | 400 `invalid_input`, subject `body`/the key/`description`/`projectId`; nothing written | same subjects as placement |
| Unknown Project | Buyer; `projectId` of a deleted or other tenant's Project | 404 `project_not_found`, subject `projectId`; nothing written | none |
| Core validation fails | the proposed Application node fails `validateBundleInput` | the envelope error from core; nothing written | envelope as-is |
| Tenant isolation | tenant B registers against tenant A's Project id | 404 `project_not_found`; only B's rows exist | none |
| Wrong method | `GET`/`PUT` on `/v1/applications/registered` | 405 with the `Allow: POST` header, like every other route | none |
| No session | no/invalid bearer token | 401 `session_invalid`, no service call | none |

</intent-contract>

## Code Map

- `packages/contract/src/applications.ts:50-57` -- `APPLICATION_API_PATHS` (add the `registered` entry + doc comment). `src/identification-file.ts:108-118` -- `IdentificationFileRendering` / `isIdentificationFileRendering` (reuse as-is). `src/index.ts` -- re-exports (path constants flow through `APPLICATION_API_PATHS`; no new export needed).
- `apps/registry/src/applications/service.ts:107-148` -- `createApplication`: the check order, `withTenant` + `lockBundle`, `validateApplicationBody`, `currentProjects`/`projectNotFound("projectId")`, `mintUuidV7`, `validateBundleInput` over `treeNodes(current)` + `liveSet` + `currentLockedIds` + application rows plus the new node, insert (`fromFlow`, `sequence` via `nextSequence`, `createdBy`), `toInfo`. Factor the mint/validate/insert tail into a private helper both create paths share.
- `apps/registry/src/applications/service.ts:164-179` -- `getIdentificationFile`: the exact `{ fileName, content }` answer shape to return on registration success.
- `apps/registry/src/applications/validate.ts:5-40` -- `validateApplicationBody` (reuse unchanged; its messages end "; nothing was created").
- `apps/registry/src/guidance-endpoint/service.ts:13-21` -- `assertGuidanceEndpointBuyer`: the Buyer-only assert pattern to copy (`role_denied`, subject `role`).
- `apps/registry/src/http/server.ts:120-139` -- `ROUTES` (add the registration route); `:378-388` the Applications case (style to follow); `:408-417` the Guidance endpoint case (the `requireBuyer` before `readJson` pattern); `:437-449` `requireBuyer`. Add the handler case near the other Application cases.
- `apps/registry/src/applications/applications.db.test.ts:263-385` -- the "placing an Application" describe: helpers `post(path, who, body)` (104), `expectRefused` (111), `setGrant` (124), `placed()` (139), `listed()` (147); Buyer is `accounts[2]` (`bo`, 193); Projects `p`/`c` (267-270). Extend with a "registering an existing Application" describe covering the whole matrix.
- `apps/registry/src/http/server.test.ts:1247-1345` -- fake-service Application suites: `GOOD_SESSION`/`BUILDER_SESSION` (1249-1250), `applications.calls` spy, `post()`/`expectEnvelope`; add registration route cases (201, 403 before body read, 401, 405 + Allow, refusal order).
- `apps/panel/src/registry.server.ts:315-321` -- `createApplication` client call (add `registerApplication` beside it); imports `isIdentificationFileRendering` from contract.
- `apps/panel/src/components/new-application.tsx:17-65` -- `NEW_APPLICATION_COPY` (add a `register` group); `:68` `NewApplicationIntent`; `:71-89` `NewApplicationActionData` (add the registration result); `:286-303` `BoilerplateResultSection` (the raised-surface pattern for the new result section).
- `apps/panel/src/routes/new-application.tsx:75-94` -- action dispatch (add `intent === "register"`); `:97-122` `refusal()` mapper; `:127-154` `endpointAction` (the ROLE_DENIED-before-body-read denial pattern).
- `apps/panel/src/routes/new-application.test.tsx:90-397` -- page tests: structure/denials/field-ink patterns, `renderPage(role, …)` (34-57), stubbed `registry(...answers)` queue (59+). Extend with the register flows.
- `apps/panel/src/registry.server.test.ts` -- the panel's registry-call tests (fixtures currently carry `agentTool`); add the `registerApplication` call cases.
- `apps/panel/src/routes/inventory.tsx:15-16,88` -- already labels a non-flow Application "Registered"; no change needed.
- `README.md:279-292` -- the Applications section: add the registering paragraph (Buyer-only route, `fromFlow: false` → baseline set, identification file only, no Boilerplate).
- `_bmad-output/implementation-artifacts/sprint-status.yaml:32,61` -- `last_updated` (DD-MM-YYYY HH:MM convention) and the `3-5-…` status line: set `ready-for-dev` at planning, `in-progress` when implementation starts, `done` when verified.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/applications.ts` (+ tests) -- the `registered` path with its doc comment.
- `apps/registry/src/applications/service.ts` -- `assertApplicationBuyer`, `registerApplication`, the shared insert helper; `ApplicationService` gains `registerApplication`.
- `apps/registry/src/http/server.ts` -- the route entry, the `requireBuyer`-then-register handler case.
- `apps/registry/src/applications/applications.db.test.ts`, `src/http/server.test.ts` -- every matrix row.
- `apps/panel/src/registry.server.ts` (+ `src/registry.server.test.ts`) -- the `registerApplication` call and its cases.
- `apps/panel/src/components/new-application.tsx`, `src/routes/new-application.tsx` (+ `src/routes/new-application.test.tsx`) -- the register form, action, result section, copy and tests.
- `README.md`, `sprint-status.yaml` -- the registering paragraph; the story's status line and `last_updated`.

**Acceptance Criteria:**
- Given the Buyer on the New-application flow surface, when they submit the register form with a name and a Project, then the page shows the identification file (`fileName` and exact content) with text telling them to commit it, and the Applications list shows the Application flagged "Registered" with no agent tool.
- Given a Builder or a Standard owner, when they submit the register form, then they receive a denial naming that only the Buyer can register, and nothing is created.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 16 findings — high 0, medium 0, low 7, false 9, maybe-false 0
- findings:
  - `[low]` `[patch]` BH1: the Buyer-side transport refusals of `POST /v1/applications/registered` (non-JSON → 400 `body`, oversized → 413, non-JSON content-type → 415) were untested; only the non-Buyer raw-body path exercised transport inputs. Fixed: `rawPost` gained a content-type parameter and a new DB test pins all three refusals with nothing written.
  - `[low]` `[patch]` BH2: the Buyer-only rule was never proven against the one non-Buyer a placement would admit — a non-Buyer holding a current build grant. Fixed: the Builder-refusal test grants the Builder a build grant on `r.id` first and still asserts 403 `role_denied`.
  - `[low]` `[patch]` BH3: the invalid-body `it.each` lacked a non-string `projectId` row even though the placement contract names it. Fixed: the row (`numeric projectId` → 400 subject `projectId`) joined the matrix, with the spread logic corrected so a non-string `projectId` is no longer overwritten.
  - `[low]` `[reject]` BH4: bundle-lock serialization is asserted in prose but never tested for a concurrent registration against a placement. Not caused by this story: the lock request (`lockBundle` under `withTenant`) is shared with the pre-existing placement path, which has no serialization test either; a concurrency test is beyond a direct correction.
  - `[false]` `[reject]` BH5: no direct test asserts registration writes nothing to `application_agent_tool_changes`. The existing assertion is conclusive: `currentAgentTool` answers `null` only when no row exists, so the list's `agentTool: null` pins the absent row.
  - `[false]` `[reject]` BH6 + VG1: a 400 `invalid_input` whose subject is neither `description` nor `projectId` falls through to the 503 denial in `registerAction`. Unreachable through the shipped client — the panel posts exactly `{ description, projectId }` — and identical to the pre-existing place-form `refusal()` behavior.
  - `[false]` `[reject]` BH7: the new `.boilerplate-result pre` CSS rule was claimed to restyle the existing Boilerplate result surface. The only `<pre>` under that class in the panel is the new registration section's; the existing section renders a list and a link.
  - `[low]` `[reject]` BH8: the registration result section disappears on the next submit and the minted id is visible only in the file bytes. By design: the lifecycle mirrors the existing Boilerplate result section exactly, the Applications list and the identification-file GET re-answer the file, and the spec's design notes record the file-only answer deliberately; persistent display would add state beyond the spec.
  - `[low]` `[patch]` BH9: the README's registering paragraph did not say the placement's build-grant step does not apply. Fixed: one clause added ("with no build-grant step, since only the Buyer registers").
  - `[false]` `[reject]` BH10: the spec's change log was empty while the story introduces a contract path. The change log records spec amendments during review loops, not the implemented change; empty at first review is the designed state.
  - `[false]` `[reject]` BH11 + IA1: the AC's word "name" is realized as the existing Description field. Vocabulary only — the story text predates the field naming; both forms label the field "Description" consistently with placement.
  - `[low]` `[reject]` BH12: `registerAction` duplicates `refusal()`'s mapping nearly line for line. Style: the repo already keeps one mapper per form intent (`refusal`, `endpointAction`, `boilerplateAction`); a shared parameterized helper is a refactor beyond a direct correction.
  - `[false]` `[reject]` IA2: nothing in the diff measures or asserts the FR-23 baseline set as an outcome. The story's mechanism is the `fromFlow: false` flag (which the diff writes and tests); the adherence measurement is Epic 7's, outside this story's surfaces.
  - `[false]` `[reject]` IA3: the success answer contains no Application object, so "receives only its identification file" is a deliberate narrowing. Recorded in the spec's design notes (the file embeds the minted id), and the edge-case layer's claims check traced the answer byte-identical to `getIdentificationFile`.


## Design Notes

- **A separate route, not a flag on `POST /v1/applications`.** Placement and registration differ in who may call them and in what they return; a discriminated field would let a Builder smuggle a baseline-set row through the placement path and would muddy the wire contract. A dedicated Buyer-only path checked before the body is read reuses the Guidance endpoint's proven pattern.
- **Role before body.** Like the Guidance endpoint, the registration denial must not depend on the body being readable: `requireBuyer` drains the body and throws `role_denied` before `readJson`.
- **The answer is the file only.** The identification file content embeds the minted Application id and Project id, so "only its identification file" loses nothing the Buyer needs; the Inventory list shows the new Application immediately.

## Verification

**Commands:**
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm -r run test` -- expected: all suites pass with the DB suites run.
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: exit 0 (run per package; root `turbo` may fail with "Exec format error").
- `pnpm -r run test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Buyer can now register an existing Application on the New-application flow surface: the registry creates it with a minted id, flagged not from the flow (`fromFlow: false`, the baseline set), and returns only its Project identification file to commit — no Boilerplate. Builder and Standard owner receive a denial before the body is even read.
- **Contract.** `APPLICATION_API_PATHS.registered = "/v1/applications/registered"`; request reuses `ApplicationCreateRequest`, response reuses `IdentificationFileRendering`.
- **Registry.** `registerApplication` (Buyer-only, checked before the body, then body → Project → core validation under the bundle lock, first failure wins and nothing written) shares the mint/validate/insert tail `insertApplication` with placement; placement's grant logic is untouched. No migration; no agent-tool row; the applications table is the only write.
- **HTTP.** Static `["POST"]` route; `requireBuyer` drains the body for any non-Buyer, then 201 with the identification file.
- **Panel.** The "Register an existing Application" form (secondary button, gold stays on placement), shown to every role, keeps submitted values on a refusal, and on success shows a raised section with the file's name and exact content, telling the Buyer to commit it to the repository root.

**Files changed:**
- `packages/contract/src/applications.ts` (+ test): the `registered` path constant with its doc comment.
- `apps/registry/src/applications/service.ts`: `assertApplicationBuyer`, `registerApplication`, the shared `insertApplication` helper, the service interface.
- `apps/registry/src/http/server.ts`: the route entry and the `requireBuyer`-then-register handler case.
- `apps/registry/src/applications/applications.db.test.ts`: the full registration matrix — Buyer happy path with byte-identity to the identification-file GET, Builder (with and without a build grant) and Standard-owner refusals proved before the body is read, every invalid-body subject, transport refusals (400/413/415), foreign/unknown/malformed Projects, the core envelope pass-through seeded via an out-of-band two-Project cycle, 401/405.
- `apps/registry/src/http/server.test.ts`: the fake-service registration suite (201, 403 before body read with no service call, 401, refusal order, 405 + Allow).
- `apps/panel/src/registry.server.ts` (+ `src/registry.server.test.ts`): the `registerApplication` client call and its cases.
- `apps/panel/src/components/new-application.tsx`, `src/routes/new-application.tsx` (+ page tests, `components.css`): the register form, action, result section, copy, and field-id prefixes for the two mounted forms.
- `README.md`, `sprint-status.yaml`: the registering paragraph; the story's status line and `last_updated`.

**Review findings:** 16 findings: high 0, medium 0, low 7, false 9.
- **Patched (low):** the Buyer-side transport-refusal tests (BH1); the build-grant-holding non-Buyer refusal proof (BH2); the non-string `projectId` matrix row (BH3); the README's missing no-grant-step clause (BH9).
- **Deferred:** none.
- **Rejected:** 3 low and 9 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 4 entries.

**Verification:**
- With `REGISTRY_TEST_DATABASE_URL` (local PostgreSQL 18 Docker): contract 268, core 61, registry 738, panel 374 passed + 1 skipped (pre-existing), boundaries 17, cli/service/collector/extractor 1 and 16 each — all suites green.
- `pnpm -r run build`, `typecheck` and `lint` exit 0 (0 warnings), and `pnpm run boundaries` reports no violations.
- `pnpm -r run test` without the database URL: passes, DB suites skipped.
- Matrix audit: every I/O-matrix row is covered by a test that ran and passed in the DB run (including the "core validation fails" row, covered by the seeded-cycle test).

**Residual risks:**
- Choices made on the human's behalf:
  - The success answer is the identification file only — no Application object (the file embeds the minted id; recorded in the design notes).
  - The register form is shown to every role, with the denial announced as a status (controls are never hidden by role).
  - The result section's lifecycle matches the Boilerplate section's (cleared on the next submit).
- A core-validation failure is unreachable through the API (a fresh id on a checked Project); the covering test seeds the state out of band, and the passthrough is shared with placement.
- A pre-existing panel flake (`project-tree.test.tsx` focus-navigation test under heavy parallel load) was observed twice during this run; it passes in isolation and in most full runs, and this story does not touch that file.
- Tested on PostgreSQL 18 (Docker) and Node 22.
