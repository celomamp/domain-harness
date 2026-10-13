---
title: 'Story 3.2: Define the Project identification file'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'fc163635d6af7d2d9d1b991226fa0c48d93fdd24'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1-builder-places-a-new-application-on-a-project.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Applications now exist (3.1), but nothing defines the one small file that lets Guidance, the Gate and Collectors find an Application the same way, and the registry cannot hand that file out (FR-10, AD-6, AD-16).

**Approach:**
- `packages/contract` defines the file: its name, a versioned JSON format carrying a semver, the Application id and an advisory Project id, one canonical serializer, and a parser that answers parsed, "missing" or "unreadable", never a default.
- The registry renders an Application's file through that serializer and serves it at `GET /v1/applications/{id}/identification-file`.

## Boundaries & Constraints

**Always:**
- **Contract** (new `packages/contract/src/identification-file.ts`, re-exported from `index.ts`; pure, no I/O, no dependency):
  - `IDENTIFICATION_FILE_NAME = ".domain-harness.json"` — a dotfile at the repository root.
  - `IDENTIFICATION_FILE_VERSION = "1.0.0"`; `IDENTIFICATION_FILE_MAJOR = 1`.
  - `IdentificationFile { version: string; applicationId: UuidV7; projectId: UuidV7 }`. `projectId` is documented as advisory: consumers resolve the Project from the bundle by Application id, and a mismatch is reported, never used.
  - `formatIdentificationFile(applicationId, projectId): string` — the only serializer: `JSON.stringify({ version: IDENTIFICATION_FILE_VERSION, applicationId, projectId }, null, 2) + "\n"`, keys in exactly that order, so equal inputs give byte-identical output.
  - `parseIdentificationFile(content: string | null): IdentificationFileResult`, where the result is `{ kind: "parsed", file }`, `{ kind: "missing" }` or `{ kind: "unreadable", error: ErrorEnvelope }`. Never throws, never fills a default. Rules, first failure wins:
    1. `null` (no file) → `missing`.
    2. Not valid JSON, or not a JSON object → unreadable, subject `file`.
    3. `version` not a string matching `MAJOR.MINOR.PATCH` (non-negative integers, no leading zeros, no pre-release) → unreadable, subject `version`.
    4. Major ≠ 1 → unreadable, subject `version`, message naming the major found and the supported one.
    5. `applicationId` not a UUIDv7 → unreadable, subject `applicationId`.
    6. `projectId` not a UUIDv7 → unreadable, subject `projectId`.
    7. Otherwise `parsed`, with the three fields only. Unknown extra keys are ignored (a minor version may add keys); a higher minor or patch of major 1 is parsed.
  - Every unreadable error uses the envelope with code `IDENTIFICATION_FILE_UNREADABLE = "identification_file_unreadable"`. The message carries field names and ids only, never file content.
  - `IdentificationFileRendering { fileName: string; content: string }` and a guard `isIdentificationFileRendering`; `applicationIdentificationFilePath(applicationId)` = `/v1/applications/{id}/identification-file`; `APPLICATION_NOT_FOUND = "application_not_found"` (404).
- **Registry.** `GET /v1/applications/{id}/identification-file`, open to every role, under the tenant (RLS) transaction:
  1. 401 without a session; any method other than GET → 405 as for other routes.
  2. A malformed, unknown or other tenant's Application id → `404 application_not_found`, subject `applicationId`, message "no such Application in this Company".
  3. Otherwise 200 `{ fileName: IDENTIFICATION_FILE_NAME, content: formatIdentificationFile(app.id, app.projectId) }`, where `projectId` is the Application's current Project (its stored `project_id`).
  The registry never accepts an Application id from a client for creation; ids stay minted only in `createApplication` (`mintUuidV7`).
- **README.** A "Project identification file" section: the name, the format with an example, the parse results and the endpoint.

**Never:** No Boilerplate, archive, endpoint URL, MCP bridge, header names or fingerprint (3.3, Epic 4). No panel change. No `unbound` logic, no binding table, no file reading from disk (consumers in Epics 4, 5, 8). No new table or migration. No YAML/TOML or new dependency. No default value on any parse path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Round trip | `formatIdentificationFile(a, p)` then parse | `parsed` with version "1.0.0", `a`, `p`; same inputs → identical bytes; ends with "\n" | none |
| Missing | `null` | `{ kind: "missing" }` | none |
| Not JSON / not object | `""`, `"{"`, `"[]"`, `"null"`, `"42"` | unreadable | subject `file` |
| Bad version | missing, `1`, `"1.0"`, `"01.0.0"`, `"1.0.0-beta"` | unreadable | subject `version` |
| Unknown major | `"2.0.0"`, `"0.9.0"` | unreadable, envelope code `identification_file_unreadable` | subject `version` |
| Newer minor | `"1.3.7"` with an extra key | `parsed`; extra key dropped | none |
| Bad ids | applicationId missing/uppercase/UUIDv4; projectId missing/non-string | unreadable | subject `applicationId` / `projectId` |
| Render | Builder places app A on P, then GETs A's file | 200, `fileName` ".domain-harness.json", content parses to A's id and P | none |
| Every role | Buyer, Standard owner, Builder GET the file | 200 | none |
| Not found | malformed, unknown, or Company B's Application id | — | 404 `application_not_found`, subject `applicationId` |
| No session / wrong method | no token; POST | — | 401; 405 |

</intent-contract>

## Code Map

- `packages/contract/src/ids.ts` -- `isUuidV7`/`UuidV7` for the id checks. `errors.ts` -- `ErrorEnvelope`. `guards.ts` -- `isRecord`. `applications.ts` -- `APPLICATION_API_PATHS.applications` (`/v1/applications`); add the file path helper beside the new module or in `applications.ts`, re-exported from `index.ts`. `index.test.ts` may pin the export list.
- `apps/registry/src/applications/service.ts` -- `applicationRows`, `ApplicationService`, `createApplicationService`; add `getIdentificationFile(session, applicationId)` reading one row with `withTenant` (no bundle lock needed: one row read). `createApplication` is the only `mintUuidV7` call for Applications; leave it.
- `apps/registry/src/http/server.ts` -- `PARAM_ROUTES`/`ROUTES` (pattern from `PROJECT_BUILD_GRANTS_ROUTE`), `STATUS_BY_CODE` gets `application_not_found: 404`, `handle` switch. Fake services in `server.test.ts` need the new method.
- `apps/registry/src/applications/applications.db.test.ts` -- the HTTP + DB harness with Buyer/Builder/owner sessions and a second tenant; extend it for the render rows.
- `apps/registry/src/index.ts` -- exports.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/identification-file.ts` (+ `index.ts`, `identification-file.test.ts`) -- name, versions, type, serializer, parser, codes, path, rendering guard; tests for every contract row of the matrix.
- [x] `apps/registry/src/applications/service.ts` -- `getIdentificationFile`.
- [x] `apps/registry/src/http/server.ts`, `src/index.ts` -- the route, 404 mapping, exports.
- [x] registry tests -- `server.test.ts` route/method/status with the fake; `applications.db.test.ts` render, every role, 404 cases, tenant isolation.
- [x] `README.md` -- the Project identification file section.

**Acceptance Criteria:**
- Given an Application placed through `POST /v1/applications`, when any role of that Company GETs its identification file, then the response content parses with `parseIdentificationFile` to `parsed` with that Application's id and its Project id, and equals `formatIdentificationFile` of the same pair byte for byte.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 15 findings — high 0, medium 0, low 10, false 5, maybe-false 0
- findings:
  - `[false]` `[reject]` BH1: the spec's checkboxes and logs are empty while in review. The workflow fills them at finalisation.
  - `[low]` `[reject]` BH2: the unknown-major message names the major read from the file, and a huge digit string would be echoed whole. The spec requires naming the major found; a multi-kilobyte major in a registry-written file is far-fetched, and capping it adds a branch. The "ids" vs "versions" wording is a spec phrasing nit (fix would edit the spec).
  - `[low]` `[patch]` BH3: a UTF-8 BOM made a valid file unreadable. Fixed: the parser strips one leading U+FEFF, with a test. The size-cap half is rejected: the file is read by the Epic 4/5/8 consumers, which own their read limits.
  - `[low]` `[reject]` BH4: duplicate keys resolve last-wins. Only the registry writes the file through the one serializer; detecting duplicates needs a custom JSON tokenizer.
  - `[low]` `[patch]` BH5: tests built the route path by hand, so the contract helper could drift from the real route. Fixed: the registry tests use `applicationIdentificationFilePath`.
  - `[false]` `[reject]` BH6: the real 404 logic is only tested by the DB suite. CI sets `REGISTRY_TEST_DATABASE_URL` with a Postgres service (`.github/workflows/ci.yml:48`), so it runs on the normal path, as every registry DB rule does.
  - `[low]` `[reject]` BH7: `APPLICATION_NOT_FOUND` lives in `identification-file.ts`. The spec allowed either module and it is re-exported from the package index, so importers never see the module.
  - `[low]` `[patch]` BH8: the rendering guard accepted any `fileName`. Fixed: it requires `IDENTIFICATION_FILE_NAME`, with a refusing test.
  - `[low]` `[reject]` BH9: no rule against re-serialising a newer-minor file. No code rewrites the file; only the registry writes it.
  - `[low]` `[reject]` BH10: the serializer trusts its branded `UuidV7` inputs. Its only caller passes ids from `toId` on stored rows; a runtime check adds a throwing path for an unreachable case.
  - `[false]` `[reject]` VG: no verification gaps. Nothing to act on.
  - `[low]` `[patch]` EC1: BOM. The same root cause as BH3; fixed by the same change.
  - `[false]` `[reject]` EC2: unbounded major echoed. The same claim as BH2, rejected there.
  - `[low]` `[reject]` EC3: duplicate keys. The same as BH4.
  - `[false]` `[reject]` IA1: the endpoint goes beyond the story (R1 vs R2), the "only mints" invariant has no new test, and the file reaches no repository yet. AC2 needs an observable rendering surface, and 3.3/3.5 reuse it; minting stays in `createApplication` only (unchanged 3.1 code, whose tests cover it); delivering the file into a repository is 3.3/3.5.

## Design Notes

- **Why JSON and `.domain-harness.json`.** Every consumer (registry, Company service, CI step, CLI, MCP bridge) is TypeScript and parses JSON with no dependency; a named extension lets editors and reviewers read it. The leading dot keeps it hidden, as the PRD asks.
- **Why one serializer in contract.** Story 3.4 requires the file to be byte-identical across targets; one function with a fixed key order and trailing newline makes that true by construction.
- **Why extra keys are ignored but the major is strict.** The contract is versioned by semver and consumers reject an unknown major: a minor may add fields, so a major-1 reader keeps working; a new major may change meaning, so it is unreadable rather than guessed.

## Verification

**Commands:**
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm -r run test` (local PostgreSQL; `docker compose up -d --wait postgres` where Docker exists) -- expected: all suites pass with the DB suites run.
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: exit 0 (root `turbo` fails in this container with "Exec format error", so run per package).
- `pnpm -r run test` -- expected: passes, DB suites skipped.

## Auto Run Result

Status: done

**Summary:** The Project identification file is defined in `packages/contract`, and the registry serves each Application's file.
- **Contract.** The file is `.domain-harness.json`, a hidden dotfile at the repository root. It is JSON holding `version` ("1.0.0"), `applicationId` and an advisory `projectId`.
  - `formatIdentificationFile` is the only serializer: fixed key order, two-space indent, trailing newline, so the same Application gives the same bytes.
  - `parseIdentificationFile(content | null)` returns parsed, `missing` or `unreadable` with an `identification_file_unreadable` envelope, never a default. An unknown major is unreadable; a newer minor of major 1 parses with extra keys dropped; one leading UTF-8 BOM is accepted.
- **Registry.** `GET /v1/applications/{id}/identification-file` (every role) returns `{ fileName, content }` rendered from the stored Application id and its Project. A malformed, unknown or other Company's id gets `404 application_not_found`. Ids are still minted only in `createApplication`.

**Files changed:**
- `packages/contract/src/identification-file.ts` (+ test, `index.ts`): name, versions, serializer, parser, codes, path helper, rendering guard.
- `apps/registry/src/applications/service.ts`: `getIdentificationFile`.
- `apps/registry/src/http/server.ts`, `index.ts` (+ `server.test.ts`, `applications.db.test.ts`): the route, the 404 mapping, exports and tests.
- `README.md`: the Project identification file section.

**Review findings:** 15 findings: high 0, medium 0, low 10, false 5.
- **Patched (3 entries, all low):** BH3/EC1, a leading BOM is accepted; BH8, the rendering guard requires the real file name; BH5, the registry tests build paths with the contract helper.
- **Deferred:** none.
- **Rejected:** 6 low and 5 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 3.

**Verification:**
- `pnpm -r run build`, `typecheck`, `lint` exit 0; `pnpm run boundaries` reports no violations (root `turbo` fails in this container with "Exec format error", so steps ran per package).
- With `REGISTRY_TEST_DATABASE_URL` (local PostgreSQL 16): contract 247, registry 612, panel 344 + 1 skipped (pre-existing), core 61 passed. Without it, all pass with the DB suites skipped.
- One unrelated run saw `project-tree.test.tsx` "moves focus with Up, Down, Home and End…" fail on timing; it passed on re-run and this story does not touch the panel.
- Matrix audit: every row is covered by `identification-file.test.ts`, `server.test.ts` or `applications.db.test.ts`, and each ran.

**Residual risks:**
- Choices made on the human's behalf: the name `.domain-harness.json` and JSON as the format; an HTTP endpoint as the rendering surface, open to every role; duplicate JSON keys resolve last-wins; no size cap in the parser (the Epic 4/5/8 readers own their limits).
- Tested against PostgreSQL 16 and Node 22, not the 18 and 24 the repo targets.
- The panel's Project tree focus test looks timing-sensitive under load.
