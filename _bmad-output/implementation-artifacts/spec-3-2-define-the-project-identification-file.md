---
title: 'Story 3.2: Define the Project identification file'
type: 'feature'
created: '2026-10-13'
status: 'in-progress'
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
- [ ] `packages/contract/src/identification-file.ts` (+ `index.ts`, `identification-file.test.ts`) -- name, versions, type, serializer, parser, codes, path, rendering guard; tests for every contract row of the matrix.
- [ ] `apps/registry/src/applications/service.ts` -- `getIdentificationFile`.
- [ ] `apps/registry/src/http/server.ts`, `src/index.ts` -- the route, 404 mapping, exports.
- [ ] registry tests -- `server.test.ts` route/method/status with the fake; `applications.db.test.ts` render, every role, 404 cases, tenant isolation.
- [ ] `README.md` -- the Project identification file section.

**Acceptance Criteria:**
- Given an Application placed through `POST /v1/applications`, when any role of that Company GETs its identification file, then the response content parses with `parseIdentificationFile` to `parsed` with that Application's id and its Project id, and equals `formatIdentificationFile` of the same pair byte for byte.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Design Notes

- **Why JSON and `.domain-harness.json`.** Every consumer (registry, Company service, CI step, CLI, MCP bridge) is TypeScript and parses JSON with no dependency; a named extension lets editors and reviewers read it. The leading dot keeps it hidden, as the PRD asks.
- **Why one serializer in contract.** Story 3.4 requires the file to be byte-identical across targets; one function with a fixed key order and trailing newline makes that true by construction.
- **Why extra keys are ignored but the major is strict.** The contract is versioned by semver and consumers reject an unknown major: a minor may add fields, so a major-1 reader keeps working; a new major may change meaning, so it is unreadable rather than guessed.

## Verification

**Commands:**
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm -r run test` (local PostgreSQL; `docker compose up -d --wait postgres` where Docker exists) -- expected: all suites pass with the DB suites run.
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: exit 0 (root `turbo` fails in this container with "Exec format error", so run per package).
- `pnpm -r run test` -- expected: passes, DB suites skipped.
