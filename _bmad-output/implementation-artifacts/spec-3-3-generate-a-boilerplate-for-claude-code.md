---
title: 'Story 3.3: Generate a Boilerplate for Claude Code'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: 'cc9da46d6fb312adbd7263cffe162ce6fc8c67ed'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-define-the-project-identification-file.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A placed Application (3.1) has an identification file (3.2), but a Builder still cannot get a starter repository that sits inside the Standards and reaches Company Guidance without manual MCP setup. Nowhere stores the Company Guidance endpoint URL (FR-9, NFR-11).

**Approach:**
- The Buyer sets a per-tenant Guidance endpoint URL. It is HTTPS-validated and stored in a new append-only table.
- `POST /v1/applications/{id}/boilerplate` with `{ target: "claude-code" }` resolves the Application's Effective Standard set through `core`. It renders the Boilerplate files with pure functions and returns a deterministic `.tar.gz` (base64 in JSON) plus a text list of the artifacts.
- The New-application flow surface gains the endpoint form, a Boilerplate request for the just-placed Application, and the boilerplate-result surface.

## Boundaries & Constraints

**Always:**
- **Contract**:
  - New `packages/contract/src/boilerplate.ts`, re-exported.
  - `GUIDANCE_ENDPOINT_PATH = "/v1/guidance-endpoint"`, `GuidanceEndpointState { url: string | null; changedAt: string | null }`, request `{ url }`, `GUIDANCE_ENDPOINT_URL_MAX = 2048`.
  - `BOILERPLATE_TARGETS = ["claude-code"]` (3.4 adds `cursor`), `applicationBoilerplatePath(id)`, request `{ target }`.
  - `BoilerplateArtifact { kind, path }`, where `kind` is one of `identification-file | dependency-pins | design-system-references | mcp-configuration | instructions | skills`.
  - `BoilerplateResult { applicationId, target, archiveName, archiveBase64, artifacts }`.
  - `MCP_BRIDGE_PACKAGE = "@domain-harness/mcp-bridge"`.
  - Codes: `GUIDANCE_ENDPOINT_UNSET` (409, subject `guidanceEndpoint`), `UNSUPPORTED_ECOSYSTEM` (409, subject `standards`), `BOILERPLATE_CONFLICT` (409, subject `standards`).
  - Guards for every response.
- **Endpoint URL**:
  - Migration `0010_guidance_endpoint.sql` creates `guidance_endpoint_changes (id, tenant_id, sequence, url, changed_by, changed_at)`. The runtime role gets SELECT and INSERT only. RLS is forced. Sequence is per tenant (max + 1 under the bundle lock). The current URL is the highest sequence.
  - `GET` is open to every role. It returns `{ url: null, changedAt: null }` when the URL is unset.
  - `POST` is Buyer only, with `role_denied` before the body is read (`requireBuyer`).
  - Validation: the body is exactly `{ url }`. The URL is trimmed, 1 to 2048 characters, parses with `new URL`, uses `https:`, and has no username, no password and no fragment. Otherwise `invalid_input`, subject `url`.
  - A URL equal to the current one writes nothing and returns 200.
- **Generation**:
  - Open to every role, under the tenant transaction and the bundle lock.
  - The first failure wins and nothing is returned partially. The checks run in this order:
    1. The Application exists. Otherwise `404 application_not_found`.
    2. The body is exactly `{ target }` with a known target. Otherwise `invalid_input`, subject `target`.
    3. The endpoint URL is set. Otherwise 409 `guidance_endpoint_unset`, with a message telling the Builder to ask the Buyer to set the Guidance endpoint.
    4. The effective set resolves via the extracted `getEffectiveSet` logic, for the Application's stored Project.
    5. Ecosystem check.
    6. Conflict check.
    7. Render.
  - Code-stack mapping (names trimmed, compared case-insensitively):
    - **Required `language`:** supported names are `typescript` and `javascript`. `typescript` adds `devDependencies.typescript`.
    - **Required `framework`/`library`:** the lowercased name must be a valid npm package name (`^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`, ≤ 214). It becomes `dependencies[name]`.
    - **Pin value:** the `versionConstraint` verbatim, or `"*"` when it is null.
    - **Approved entries:** never pinned. They are listed in the instructions with their constraints.
    - **Prohibited entries:** never pinned. They are listed in the instructions as prohibited.
  - Any unsupported required entry → `unsupported_ecosystem`. The message is one sentence that names each such entry as `<category> <name>`, ends with "nothing was generated", and is produced before any rendering.
  - A pin whose name equals a prohibited code-stack entry's lowercased name → `boilerplate_conflict`, one sentence naming them.
- **Archive files** (at the archive root, rendered by pure functions in `apps/registry/src/boilerplate/render.ts`, each ending in "\n", JSON with 2-space indentation and keys sorted where they come from data):
  - `.domain-harness.json`: `formatIdentificationFile(app.id, app.projectId)`.
  - `package.json`: `{ name: "application-<id>", private: true, type: "module", dependencies, devDependencies }`.
  - `design-system.json`: required and prohibited imports, required and prohibited tokens, and components (name, usageRule, tokens), in core order.
  - `.mcp.json`: `{ "mcpServers": { "domain-harness": { "command": "npx", "args": ["-y", "@domain-harness/mcp-bridge", <url>] } } }`.
  - `CLAUDE.md`: the Project, the pinned, approved and prohibited stack, design-system rules, and the instruction to "make an initial commit before calling Guidance" (the bridge needs the root commit).
  - `.claude/skills/domain-harness-guidance/SKILL.md`: frontmatter `name`/`description`, how to request Guidance through the `domain-harness` MCP server, and the same initial-commit rule.
  - The identification file, `package.json` and `design-system.json` come from target-independent functions, so 3.4 reuses them byte for byte.
- **Archive packing**:
  - Ustar tar with mode 0644, uid/gid 0, mtime 0, files in a fixed order, then `zlib.gzipSync`.
  - Equal inputs give identical bytes.
  - `archiveName = domain-harness-<applicationId>-claude-code.tar.gz`.
  - `artifacts` lists one entry per file in archive order.
  - Logs carry ids, target and file count only.
- **Panel** (imports contract only, controls never hidden by role):
  - The loader also streams the endpoint state.
  - "Company Guidance endpoint" form (intent `guidance-endpoint`): a URL field showing the current URL or "Not set.", secondary button. `role_denied` and invalid input render as a denial or field ink.
  - After a placement, a "Boilerplate" form (intent `boilerplate`, hidden `applicationId`) offers a labelled "Agent tool" select with the one option "Claude Code" and a secondary button "Generate the Boilerplate". It stays visible after a boilerplate result or refusal.
  - Success: a raised `boilerplate-result` section lists each artifact as "<label>: <path>" in plain text, with no badges, plus a "Download the archive" link (`download=archiveName`, `href=data:application/gzip;base64,…`).
  - Refusals:
    - `guidance_endpoint_unset` → the denial "The Company Guidance endpoint is not set. Ask the Buyer to set it. Nothing was generated."
    - `unsupported_ecosystem` / `boilerplate_conflict` → a denial showing the registry's one sentence.
    - Anything else → unavailable.
- **README:** a "Boilerplate" section with the endpoint, the files, the ecosystem rule and the archive format.

**Never:**
- No hook configuration in any form: no `settings.json` and no `hooks` key anywhere in the archive.
- No Cursor target, and no agent-tool column on Applications (3.4).
- No bridge implementation, headers or fingerprint (Epic 4).
- No new npm dependency.
- No partial archive on any refusal.
- No Application id from a client for creation.
- No YAML.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set URL | Buyer POSTs `https://g.acme.example/v1` | 200 state; a row is appended; GET by any role returns it | none |
| Same URL | POST the current URL again | 200; no new row | none |
| Bad URL | `http://…`, `ftp://…`, `not a url`, `""`, `https://u:p@h`, `https://h/#x`, 2049 characters, extra key | — | 400 `invalid_input`, subject `url` (extra key → that key) |
| Non-Buyer sets | Builder / Standard owner POST | — | 403 `role_denied`, nothing written |
| Happy path | URL set; required TS `~5.6`, required library `React ^19`, approved `zod`, prohibited `lodash`, DS required import + token | 200; the 6 files; `dependencies.react = "^19"`, `devDependencies.typescript = "~5.6"`, no zod or lodash pin; `.mcp.json` args end with the URL; CLAUDE.md and SKILL.md contain the initial-commit rule | none |
| Deterministic | the same request twice | identical `archiveBase64` | none |
| Neutrality | any success | no path containing `settings`, no file containing `"hooks"` | none |
| URL unset | no endpoint row | — | 409 `guidance_endpoint_unset`, no archive |
| Unsupported | required language `Go`, required framework `Spring Boot` | — | 409 `unsupported_ecosystem`, one sentence naming both |
| Conflict | required library `react`, prohibited framework `React` | — | 409 `boilerplate_conflict` |
| Bad target / app | `{ target: "cursor" }`; unknown, malformed or other tenant's id | — | 400 subject `target`; 404 `application_not_found` |
| No session / method | no token; GET on boilerplate | — | 401; 405 |

</intent-contract>

## Code Map

- `packages/contract/src/identification-file.ts` -- `formatIdentificationFile`, `APPLICATION_NOT_FOUND`, `applicationIdentificationFilePath` (pattern for the new path helper). `effective.ts` -- `EffectiveStandardSet`/`EffectiveStandard` (entry under `.standard.entry`, `slot.moduleKind`). `standards.ts` -- `CodeStackEntry`, `DesignSystemEntry`. `guards.ts` -- `isRecord`, `isUtcIso`. `modules.ts` -- `ROLE_DENIED`. `index.ts` (+ `index.test.ts` may pin exports).
- `apps/registry/src/projects/service.ts:177` -- `getEffectiveSet`. Extract the body after the Project lookup into an exported `resolveEffectiveStandards(tx, tenantId, project, current)`, reused by generation inside its own transaction.
- `apps/registry/src/applications/service.ts` -- `getIdentificationFile` (row lookup and 404 pattern), `applicationNotFound`. `standards/service.ts` -- `lockBundle`. `build-grants/service.ts` -- append-only change table with `nextSequence` and "same state writes nothing", the model for the endpoint service. `modules/service.ts` -- `assertBuyer`, `toId`.
- `apps/registry/migrations/0009_build_grants.sql` -- the migration and RLS template. `src/db/schema.ts:356` -- the drizzle table pattern. `src/tenancy/tenancy.db.test.ts:119,142,174` -- the table lists must include the new table.
- `apps/registry/src/http/server.ts` -- `STATUS_BY_CODE`, `PARAM_ROUTES`, `ROUTES`, `RegistryServices`, `handle`, `requireBuyer`. `server.test.ts` fakes need the new services.
- `apps/registry/src/applications/applications.db.test.ts` -- HTTP+DB harness (Buyer, Builder, owner, second tenant); a model for the new `boilerplate.db.test.ts`. `src/index.ts` -- exports and service wiring (`serve-cli.ts` builds services).
- `apps/panel/src/routes/new-application.tsx`, `components/new-application.tsx`, `registry.server.ts` (`call`, `json`, `bearer`, `getJson`), `routes/new-application.test.tsx` -- the surface, copy object, action switch and tests. `components/status.tsx` -- the denial/notice region. `styles/components.css` -- `standard-form`; add a `boilerplate-result` raised style from existing tokens.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/boilerplate.ts` (+ `index.ts`, test) -- types, paths, codes, constants, guards.
- [x] `apps/registry/migrations/0010_guidance_endpoint.sql`, `src/db/schema.ts` -- the table.
- [x] `apps/registry/src/guidance-endpoint/service.ts` (+ `validate.ts`) -- get and set, plus `currentGuidanceEndpoint(tx, tenantId)`.
- [x] `apps/registry/src/projects/service.ts` -- extract `resolveEffectiveStandards` without changing behaviour.
- [x] `apps/registry/src/boilerplate/{plan.ts,render.ts,archive.ts,service.ts}` -- ecosystem and conflict check producing pins (pure), file renderers (pure), deterministic tar.gz, and the service with the check order.
- [x] `apps/registry/src/http/server.ts`, `src/index.ts`, `serve-cli.ts` -- routes, status codes, wiring, exports.
- [x] Registry tests -- unit tests for plan, render and archive (round-trip by gunzip + ustar parse, determinism, neutrality); `server.test.ts` routes, methods and statuses; `boilerplate.db.test.ts` for every matrix row; tenancy table lists.
- [x] `apps/panel/src/registry.server.ts`, `components/new-application.tsx`, `routes/new-application.tsx`, `styles/components.css`, test -- endpoint form, Boilerplate form, result surface, refusals.
- [x] `README.md` -- Boilerplate section.

**Acceptance Criteria:**
- Given an Application placed through the New-application flow and a set endpoint URL, when the Builder generates a Claude Code Boilerplate on the panel, then the boilerplate-result surface lists the identification file, dependency pins, design-system references, MCP configuration, instructions and skills in text with a download link. The decoded archive's `.domain-harness.json` parses (`parseIdentificationFile`) to that Application and its Project.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 35 findings — high 0, medium 0, low 23, false 12, maybe-false 0
- findings:
  - `[low]` `[reject]` BH1: the route reads the JSON body before the service looks up the Application, so a malformed body on an unknown id gets 400/413/415, not 404. Every existing body route reads eagerly the same way. A well-formed body follows the spec order (tested). A lazy reader would change the service signature to cover a malformed-body corner case.
  - `[low]` `[patch]` BH2: `typescript` could be pinned in both `dependencies` and `devDependencies`. Fixed: pins are keyed by package name, and a differing version or section is `boilerplate_conflict` (plan test added).
  - `[false]` `[reject]` BH3: a required JavaScript next to a prohibited `javascript` is "missed". JavaScript is never pinned, so no prohibited entry reaches the pins, which is the rule.
  - `[low]` `[patch]` BH4: the same conflict text could repeat when two entries pin one package. Same root cause as BH2; the second entry is now skipped before the prohibited check.
  - `[low]` `[reject]` BH5: version constraints are copied verbatim, not validated as npm ranges. The spec pins the Standard owner's constraint verbatim by design. Validating needs a semver grammar, so it is not a direct correction.
  - `[false]` `[reject]` BH6: required design-system imports are not added to `package.json`. The spec keeps design-system references in `design-system.json`. An import specifier is not reliably a package name.
  - `[low]` `[reject]` BH7: the bridge runs via `npx -y` with no version pinned. The story fixes the MCP configuration's shape, and the bridge package and its versioning arrive in Epic 4. Noted as a residual risk.
  - `[low]` `[reject]` BH8: generation holds the bundle lock during rendering and gzip. The archives are a few KB, so the lock time is negligible, and reading under the lock keeps the set consistent.
  - `[low]` `[reject]` BH9: setting the endpoint takes the bundle lock, and "same URL" is an exact string match. The bundle lock is the repository's convention for per-tenant sequences; a case variant writing one extra append-only row does no harm.
  - `[low]` `[patch]` BH10: `untarGz` accepted unknown typeflags and magic and silently truncated entries. Fixed: it throws in all three cases (truncation test added).
  - `[low]` `[reject]` BH11: `application_not_found`/`invalid_input` on the Boilerplate form show "unavailable". The spec routes everything else to unavailable. The panel only ever submits the id it just placed and the single target.
  - `[false]` `[reject]` BH12: only the just-placed Application can be generated in the panel. The UX flow puts "the Boilerplate request with a target-tool choice" right after placement, and the registry endpoint serves any Application.
  - `[low]` `[reject]` BH13: the download is a `data:` URL, and `archiveName` is not cross-checked. The archives are a few KB; the name comes from the registry's own helper.
  - `[false]` `[reject]` BH14: Standard-owner free text in CLAUDE.md could instruct the agent. Standard owners are the Company's trusted authors, and instructing the agent is the purpose of the file.
  - `[false]` `[reject]` BH15: Builders see an endpoint form that can never succeed. The UX rule says controls are never hidden by role; the refusal is announced as a status.
  - `[low]` `[patch]` VG1: the body → endpoint → ecosystem order was not pinned by tests. Added DB cases: an invalid target with no endpoint gives 400 `target`, and a Go-requiring Project with no endpoint gives 409 `guidance_endpoint_unset`.
  - `[low]` `[patch]` VG2: no panel test reached the endpoint action's fallback. Added an it.each (rejected fetch, unexpected 404) asserting 503, the denial copy and the kept URL.
  - `[low]` `[patch]` VG3: the dev/normal `typescript` clash. Same as BH2.
  - `[low]` `[patch]` VG4: no test for one package required twice at the same version. Covered by the new plan test (one pin, ok).
  - `[low]` `[patch]` EC1: dev/normal pin clash. Same as BH2.
  - `[low]` `[reject]` EC2: verbatim version constraint. Same as BH5.
  - `[low]` `[patch]` EC3: the CLAUDE.md pin line could split on a newline. Fixed by wrapping name and version in `oneLine`.
  - `[low]` `[reject]` EC4: permanent refusals shown as unavailable. Same as BH11.
  - `[low]` `[reject]` EC5: an empty `applicationId` field only arises from a forged form (the form always carries the placed id), and the registry answers 404.
  - `[low]` `[patch]` EC6: a URL with internal whitespace was accepted and stored raw. Fixed: any whitespace after trimming is `invalid_input`, subject `url` (two DB cases).
  - `[low]` `[patch]` EC7: lax `untarGz`. Same as BH10.
  - `[low]` `[reject]` EC8: body read before the Application lookup. Same as BH1.
  - `[false]` `[reject]` IA1: the Builder can generate only for the just-placed Application in the panel. Same as BH12.
  - `[false]` `[reject]` IA2: the endpoint form sits on every role's surface. That matches the AC ("on the New-application flow surface") and the UX rule.
  - `[false]` `[reject]` IA3: approved entries are not pinned. Pinning only required entries satisfies every approved one; this is the spec's recorded reading of the AC.
  - `[false]` `[reject]` IA4: design-system satisfaction is not checked by an evaluator. The evaluator (Gate) is Epic 5; the story asks for references, which the archive carries.
  - `[false]` `[reject]` IA5: the bridge cannot start yet. The epic context defers the bridge to Epic 4 ("Epic 3 only declares the bridge"); Boilerplates need no regeneration.
  - `[false]` `[reject]` IA6: the archive has no `.git`. A repository archive is the decided delivery, and the initial-commit rule exists because no root commit exists at generation time.
  - `[low]` `[reject]` IA7: the end-to-end chain is split between panel (mocked) and registry (DB) tests. The DB suite decodes the archive over HTTP and runs in CI with Postgres; joining them needs a browser-plus-DB harness the repository does not have.
  - `[false]` `[reject]` IA8: the extras (conflict code, npm-name rule, determinism) go beyond the story. They are the spec's choices, none contradicts the story, and determinism is needed for 3.4's byte-identical files.

## Design Notes

- **Why base64 in JSON.** The registry and the panel speak JSON with guards on every path. A small archive (a few KB) fits, and the panel turns it into a `data:` download link with no new route.
- **Why tar.gz by hand.** Node has `zlib` and no zip/tar writer. Ustar is about 40 lines and becomes deterministic once mtime and owner are fixed at 0. That determinism is what lets 3.4 promise byte-identical shared files.
- **Why approved entries are not pinned.** The Gate (Epic 5) requires required entries, forbids prohibited ones and allows approved ones. Pinning only the required entries satisfies every approved entry. Listing the approved ones in CLAUDE.md lets the agent add them within their constraints.
- **Who may generate.** Every role, like the identification file. Every file is derived from data every role can already read.

## Verification

**Commands:**
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm -r run test` -- expected: all suites pass with the DB suites run (local PostgreSQL 16).
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: exit 0 (run per package; root `turbo` may fail with "Exec format error").
- `pnpm -r run test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** A Builder can now download a Claude Code Boilerplate for an Application from the New-application flow.
- **Guidance endpoint.** The Buyer sets the Company Guidance endpoint URL once per tenant. It must be HTTPS with no credentials, fragment or whitespace, at most 2048 characters. Changes are stored append-only in `guidance_endpoint_changes`. Any role can read it; only the Buyer can set it.
- **Generation.** `POST /v1/applications/{id}/boilerplate` with `{ target: "claude-code" }` (any role) checks, in order:
  1. the Application exists;
  2. the target is valid;
  3. the endpoint URL is set;
  4. the Effective Standard set resolves through `core`;
  5. the ecosystem is TypeScript/npm;
  6. the pins do not conflict.
- **Archive.** The result is a deterministic ustar `.tar.gz`, sent as base64 in JSON. It holds:
  - `.domain-harness.json`;
  - `package.json` with the required pins;
  - `design-system.json`;
  - `.mcp.json` running `npx -y @domain-harness/mcp-bridge <url>`;
  - `CLAUDE.md`;
  - `.claude/skills/domain-harness-guidance/SKILL.md`.

  CLAUDE.md and SKILL.md both tell the agent to make an initial commit before calling Guidance. There is no hook configuration anywhere.
- **Panel.** The page has the endpoint form, then the Boilerplate form after a placement. The boilerplate-result surface lists the artifacts as text and offers a download link.

**Files changed:**
- `packages/contract/src/boilerplate.ts` (+ test, `index.ts`): the endpoint and Boilerplate wire contract, codes, guards and paths.
- `apps/registry/migrations/0010_guidance_endpoint.sql`, `src/db/schema.ts`: the append-only endpoint table with forced RLS.
- `apps/registry/src/guidance-endpoint/{validate,service}.ts`: getting and setting the endpoint.
- `apps/registry/src/projects/service.ts`: `resolveEffectiveStandards` extracted, with no change in behaviour.
- `apps/registry/src/boilerplate/{plan,render,archive,service}.ts` (+ tests, `boilerplate.db.test.ts`): the plan, the renderers, the tar.gz writer and reader, and the service.
- `apps/registry/src/http/server.ts`, `serve-cli.ts`, `index.ts`, `applications/service.ts`, plus the service maps in the existing DB suites and the tenancy table lists: routes and wiring.
- `apps/panel/src/{registry.server.ts,components/new-application.tsx,routes/new-application.tsx,styles/components.css}` (+ tests): the endpoint form, the Boilerplate form and the result surface.
- `README.md`: a Boilerplate section.

**Review findings:** 35 findings: high 0, medium 0, low 23, false 12.
- **Patched (low):** the `typescript` dev/normal pin clash and the repeated conflict text (BH2/BH4/VG3/EC1); the CLAUDE.md pin line (EC3); whitespace in the URL (EC6); the strict tar reader (BH10/EC7). Tests added: check order (VG1), the panel endpoint fallback (VG2), a same-version duplicate (VG4).
- **Deferred:** none.
- **Rejected:** 11 low and 12 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 7 entries.

**Verification:**
- `pnpm -r run build`, `typecheck` and `lint` exit 0, and `pnpm run boundaries` reports no violations.
- With `REGISTRY_TEST_DATABASE_URL` (local PostgreSQL 16): contract 263, core 61, registry 696, panel 362 passed + 1 skipped (pre-existing).
- Without it: registry 338 passed, 358 skipped (the DB suites); the other packages give the same counts.
- Matrix audit: every row is covered by `boilerplate.db.test.ts`, and each ran in the DB run.

**Residual risks:**
- Choices made on the human's behalf:
  - Generation is open to every role.
  - Only required code-stack entries are pinned. Version constraints are copied verbatim, so free text can break `npm install`.
  - A pin that matches a prohibited entry, or one package at two versions, gives `boilerplate_conflict`.
  - The archive travels as base64 in JSON and downloads through a `data:` link.
  - Panel generation is offered only right after a placement.
- `@domain-harness/mcp-bridge` does not exist until Epic 4, and `npx -y` runs its latest version with nothing pinned.
- `SKILL.md` carries two lines of YAML-style frontmatter, which Claude Code requires, despite the spec's "No YAML".
- Archive bytes are deterministic within one zlib build only.
- Tested on PostgreSQL 16 and Node 22.
