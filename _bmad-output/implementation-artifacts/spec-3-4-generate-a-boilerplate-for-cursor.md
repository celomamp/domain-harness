---
title: 'Story 3.4: Generate a Boilerplate for Cursor'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '9498fae5705b001cd48784330f1b496afb6c208e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-generate-a-boilerplate-for-claude-code.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 3.3 generates a Boilerplate only for Claude Code; a Builder who uses Cursor cannot get the same starter, and nothing records which agent tool an Application uses (FR-9, Story 3.4).

**Approach:** Add `cursor` to `BOILERPLATE_TARGETS`; render the Cursor archive from the same shared files plus Cursor-native target files (`.cursor/mcp.json`, `AGENTS.md`, `.cursor/skills/domain-harness-guidance/SKILL.md`); record the chosen target on the Application in a new append-only `application_agent_tool_changes` table, exposed as `agentTool` on `ApplicationInfo`; offer Cursor in the panel's "Agent tool" select.

## Boundaries & Constraints

**Always:**
- **Contract**:
  - `packages/contract/src/boilerplate.ts`: `BOILERPLATE_TARGETS = ["claude-code", "cursor"]`; nothing else changes (`isBoilerplateTarget` then accepts `cursor`; `boilerplateArchiveName` yields `domain-harness-<id>-cursor.tar.gz`).
  - `packages/contract/src/applications.ts`: `ApplicationInfo` gains `agentTool: BoilerplateTarget | null` — the target of the Application's latest successful generation, `null` when none. `isApplicationInfo` accepts `null` or a known target. Both flow through `index.ts` unchanged.
- **Agent-tool recording**:
  - Migration `0011_application_agent_tool.sql` creates `application_agent_tool_changes (id, tenant_id, application_id, sequence, agent_tool, changed_by, changed_at)`: append-only on the `0010` template — `sequence >= 1`, `UNIQUE (tenant_id, application_id, sequence)`, `agent_tool` CHECKed to the two targets, FKs to `applications (tenant_id, id)` and `accounts (tenant_id, changed_by)`, RLS forced, `GRANT SELECT, INSERT` to the runtime role only.
  - New `apps/registry/src/applications/agent-tool.ts`: `currentAgentTools(tx, tenantId)` → one query, the latest-sequence row per application; `recordAgentTool(tx, tenantId, applicationId, target, changedBy)` — the current value equals `target` → no row; otherwise append with per-(tenant, application) sequence max + 1.
  - `generateBoilerplate` records the target as its last step, inside the existing `withTenant` transaction after render and pack succeed, so a refused generation records nothing.
  - `listApplications` answers `agentTool` from `currentAgentTools` under its existing lock; `createApplication` answers `agentTool: null`.
- **Cursor target files** (formats verified against docs.cursor.com on 2026-10-13):
  - `.cursor/mcp.json` (kind `mcp-configuration`): `{ mcpServers: { "domain-harness": { type: "stdio", command: "npx", args: ["-y", "@domain-harness/mcp-bridge", <url>] } } }` — the same bridge entry as `.mcp.json`, plus Cursor's documented `type` field.
  - `AGENTS.md` (kind `instructions`): the exact `CLAUDE.md` content with the one path reference `.mcp.json` → `.cursor/mcp.json`.
  - `.cursor/skills/domain-harness-guidance/SKILL.md` (kind `skills`): the exact Claude skill content with the same one path swap.
  - Archive order: the three shared files, then these three.
  - Refactor `renderClaudeMd` and `renderClaudeSkill` to share one body each, parameterised by the MCP config path (`.mcp.json` / `.cursor/mcp.json`); add `renderCursorMcpJson` and `renderAgentsMd`; `TARGET_FILES` gains `cursor`.
- **Panel**: `NEW_APPLICATION_COPY.boilerplate.targets` gains `"cursor": "Cursor"` (the `satisfies Record<BoilerplateTarget, string>` forces the label); the existing select then offers both. No other surface change.
- **Tests**: the three `boilerplate.db.test.ts` cases that use `{ target: "cursor" }` as the unknown target switch to a still-unknown value (e.g. `"windsurf"`); every `ApplicationInfo` fixture in registry and panel tests gains `agentTool`.

**Never:**
- No `.cursor/rules/*.mdc` and no legacy `.cursorrules` (root `AGENTS.md` plus `.cursor/skills/` are the Cursor-native formats used).
- No hook configuration in any form (Cursor has `hooks.json`; the archive never holds one), no path containing `settings`, no `"hooks"` key in any file.
- No new HTTP route; no `RegistryServices`, `serve-cli.ts` or `index.ts` wiring change (recording lives in the boilerplate service, reading in the applications service).
- No mutation of `applications` rows; no UPDATE or DELETE grant anywhere.
- No new npm dependency; no bridge implementation, headers or fingerprint (Epic 4); no panel display of the agent tool (Story 6.5 groups Inventory by it); no YAML beyond the SKILL.md frontmatter both tools require.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cursor happy path | endpoint set; TypeScript/npm set; `{ target: "cursor" }` | 200; six files; `archiveName = domain-harness-<id>-cursor.tar.gz`; artifacts list `.cursor/mcp.json`, `AGENTS.md`, `.cursor/skills/domain-harness-guidance/SKILL.md` after the shared three; AGENTS.md and the skill carry the initial-commit rule | none |
| Byte-identical | both targets, same Application | the archives' `.domain-harness.json` and `package.json` are byte-identical | none |
| Records the tool | a generation succeeds | `GET /v1/applications` shows that Application with `agentTool` = the target; `null` before any generation | none |
| Same tool again | generate the current target again | 200; no new change row | none |
| Switch tool | generate the other target | 200; one new row; the list shows the new target | none |
| Refusal records nothing | endpoint unset, unsupported ecosystem, conflict, unknown target, unknown Application | the 3.3 refusal; no change row; the list keeps the old `agentTool` | 400/404/409 as in 3.3 |
| Unknown target | `{ target: "windsurf" }` | — | 400 `invalid_input`, subject `target` |
| Other tenant | tenant B generates | B's own rows only; A's `agentTool` unchanged | 404 `application_not_found` for A's ids |
| Neutrality (cursor) | any success | no path containing `settings`, no content containing `"hooks"` | none |

</intent-contract>

## Code Map

- `packages/contract/src/boilerplate.ts:37` -- `BOILERPLATE_TARGETS` (add `cursor`). `src/applications.ts:19,57` -- `ApplicationInfo`/`isApplicationInfo` (add `agentTool`); `src/index.ts:143,166` re-export both already.
- `apps/registry/migrations/0010_guidance_endpoint.sql`, `src/db/schema.ts:427-448` -- the append-only migration + drizzle table template for `0011_application_agent_tool.sql` and `applicationAgentToolChanges`.
- `apps/registry/src/guidance-endpoint/service.ts:24,40,56` -- the current-value read, `nextSequence` and "same state writes nothing" patterns to copy in the new `src/applications/agent-tool.ts`.
- `apps/registry/src/boilerplate/service.ts:51-101` -- `generateBoilerplate`: append `recordAgentTool(...)` after `tarGz` succeeds, before the return; `toId(row.id)` for the Application id.
- `apps/registry/src/applications/service.ts:43,73,97,135` -- `toInfo` (add `agentTool`), `listApplications` (load `currentAgentTools` under the existing lock), `createApplication` (answer `null`).
- `apps/registry/src/boilerplate/render.ts:82,146,189-196` -- `renderClaudeMd`/`renderClaudeSkill` (parameterise the one MCP config path reference), `TARGET_FILES` (add the `cursor` entry), new `renderCursorMcpJson` + `renderAgentsMd`; `src/index.ts:116-128` exports the renderers (add the new ones).
- `apps/registry/src/boilerplate/render.test.ts` -- extend for the cursor renderers and cross-target byte-identity. `src/boilerplate/boilerplate.db.test.ts:142,281,285,297,493,503` -- extend for every matrix row; the three `{ target: "cursor" }` invalid-target cases must switch to another unknown target.
- `apps/registry/src/tenancy/tenancy.db.test.ts:116,141,172` -- the three table lists gain `application_agent_tool_changes` (sorts before `applications`).
- `apps/registry/src/http/server.test.ts:419-450` -- the `FakeApplications` fixtures gain `agentTool`.
- `apps/panel/src/components/new-application.tsx:46-64` -- `boilerplate.targets` gains `"cursor": "Cursor"`; the `BoilerplateForm` select needs no change. `src/routes/new-application.test.tsx:139,202`, `src/registry.server.test.ts:440,450`, `src/routes/inventory.test.tsx:17,24` -- fixtures gain `agentTool`.
- `README.md:316-345` -- the Boilerplate section: both targets, the recording table, the Cursor file table, the byte-identity sentence.

## Tasks & Acceptance

**Execution:**
- `packages/contract/src/boilerplate.ts`, `src/applications.ts` (+ tests) -- the `cursor` target and `agentTool`.
- `apps/registry/migrations/0011_application_agent_tool.sql`, `src/db/schema.ts` -- the append-only agent-tool table.
- `apps/registry/src/applications/agent-tool.ts` -- `currentAgentTools` and `recordAgentTool`.
- `apps/registry/src/applications/service.ts` -- `agentTool` in list and create.
- `apps/registry/src/boilerplate/service.ts` -- record the target on success.
- `apps/registry/src/boilerplate/render.ts` (+ `render.test.ts`, `src/index.ts`) -- shared instruction/skill bodies, `renderCursorMcpJson`, `renderAgentsMd`, the `cursor` entry.
- `apps/registry/src/boilerplate/boilerplate.db.test.ts`, `src/tenancy/tenancy.db.test.ts`, `src/http/server.test.ts` -- every matrix row, the byte-identity proof, the table lists, the fixtures.
- `apps/panel/src/components/new-application.tsx`, `src/routes/new-application.test.tsx`, `src/registry.server.test.ts`, `src/routes/inventory.test.tsx` -- the Cursor option and the fixtures.
- `README.md` -- the Boilerplate section.

**Acceptance Criteria:**
- Given a placed Application with the endpoint set and a TypeScript/npm Effective Standard set, when the Builder chooses Cursor in the Boilerplate form and generates, then the boilerplate-result surface lists the six artifacts with a download link, and the Applications list shows the Application with `agentTool: "cursor"`.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL`, when build, typecheck, lint, boundaries and test run, then all pass with the DB suites skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-13 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 15, false 7, maybe-false 0
- findings:
  - `[low]` `[patch]` BH1: sprint-status.yaml still listed the story as `backlog` while the spec was in review, and only `last_updated` was bumped. Fixed: the story line reads `done` and `last_updated` follows the file's DD-MM-YYYY convention.
  - `[low]` `[patch]` BH2: `last_updated` flipped the file's date convention to MM-DD-YYYY. Same root cause and fix as BH1: `13-10-2026 16:08`.
  - `[low]` `[patch]` BH3: the `no-circular` exemption had no proof that a cycle among non-blessed contract files still fires, though the config header demands one. Fixed: the `contract-circular` fixture and its firing test in `tooling/boundaries`.
  - `[low]` `[patch]` VG1: same as BH3 — the layer demonstrated that widening `pathNot` to the whole contract package kept every existing boundaries test green. Fixed with BH3's fixture.
  - `[low]` `[patch]` BH4: no panel test chose Cursor and generated. Fixed: one test picks `cursor`, asserts the POST body is exactly `{"target":"cursor"}` and renders the Cursor result surface.
  - `[low]` `[patch]` BH5: the README byte-identity sentence under-claimed (design-system.json also identical; the skill path also differs; the POST row omitted `agentTool`) and the DB test checked two of three shared files. Fixed: the "first three files" wording, the POST-row note, and `design-system.json` in the byte-identity loop.
  - `[low]` `[reject]` BH6: `BOILERPLATE_TARGETS` and the migration CHECK are two hard-coded lists. The migration header already ties them ("agent_tool is one of the Boilerplate targets") and the first cut's two targets are frozen by the spec; a sync-asserting test adds complexity for a drift everyday use never meets.
  - `[low]` `[reject]` BH7: `toTarget` casts the stored `agent_tool` without a runtime check. No demonstrated path reaches it with a bad value (the CHECK guards every write, `recordAgentTool` guards the write side); the rollback-skew scenario fails closed either way.
  - `[low]` `[reject]` ECH1: same as BH7 — the read trusts the CHECK as its guard; guarding undemonstrated state adds a branch without changing the outcome.
  - `[low]` `[patch]` BH8: the Cursor describe read hidden state of the earlier one (hoisted `happy`), so a filtered run failed confusingly. Fixed: `happy` is back inside the Claude Code describe and the redundant cross-describe assertion is gone.
  - `[low]` `[patch]` BH9: `createApplication` had no symmetric bad-`agentTool` unavailable cases. Fixed: the two cases joined the create test.
  - `[low]` `[reject]` BH10: `isApplicationInfo` now requires `agentTool`, so a newer panel against an older registry degrades every list. The repo's strict-guard convention applies to every contract field (`fromFlow` was required the same way); the POST-row documentation rode with BH5's patch.
  - `[low]` `[patch]` BH11: the `agentTool` readback was never read by the Standard owner. Fixed: one `sam` assertion joined the records test.
  - `[low]` `[reject]` BH12: the Cursor and Claude MCP renderers repeat the bridge entry literal. `render.test.ts` already pins `command`/`args` equality across the two; a shared helper is a style refactor beyond a direct correction.
  - `[low]` `[patch]` IA5: the sprint tracker was left stale and internally inconsistent. Same as BH1/BH2 — fixed with them.
  - `[false]` `[reject]` IA1: the intent lives at the sprint surface and the diff bridges it through the self-authored spec — the repo's documented per-story mechanism (spec commit, then feat commit); no divergence.
  - `[false]` `[reject]` IA2: the recording is observable only through the Applications API, not a panel display — the epic context and Story 6.5 defer the panel display; the wire surface carries the field and the DB suite asserts it.
  - `[false]` `[reject]` IA3: Cursor's native formats are verified by citation, not execution — no Cursor environment exists in the pilot; the formats were pinned from docs.cursor.com during planning and stay a recorded residual risk.
  - `[false]` `[reject]` IA4: the stateful guarantees live in the DB suites — the repo's convention (CI runs them against PostgreSQL 18; this run ran them: 718 passed, none skipped).
  - `[false]` `[reject]` IA6: the boundary-config edit was un-anticipated by the intent — the spec's design notes record the cycle decision, the exemption is scoped, and BH3/VG1's fixture now proves its scope.
  - `[false]` `[reject]` IA7: the `cursor`→`windsurf` and `agentTool` fixture edits are internal consistency required by the new contract.
  - `[false]` `[reject]` IA8: the stray `bmad-build-auto-result-5-1.md` is residue of a different run that resolved "next" as 5-1 — outside the reviewed diff; excluded from this story's commit and reported to the operator.

## Design Notes

- **Why an append-only change table, not a column.** The runtime role holds only SELECT and INSERT on every table; nothing in the registry mutates rows. A per-(tenant, application) sequence with "same state writes nothing" follows `guidance_endpoint_changes` exactly, and Story 6.5 can group Inventory by the current value.
- **Why `AGENTS.md` rather than `.cursor/rules/*.mdc`.** Cursor's docs describe root `AGENTS.md` as the plain-markdown instruction file — the direct analog of `CLAUDE.md`: always loaded, no frontmatter. A `.mdc` rule with `alwaysApply: true` would say the same thing with YAML the 3.3 spec already had to except once for SKILL.md.
- **`type: "stdio"` in `.cursor/mcp.json`.** Cursor's configuration table documents `type: "stdio"` as required for STDIO servers, while its own CLI example omits it; carrying the documented field is the safe side of that conflict and adds nothing the neutrality rule forbids.
- **The contract import cycle is safe.** `applications.ts` will import `isBoilerplateTarget` from `boilerplate.ts` while `boilerplate.ts` imports `APPLICATION_API_PATHS` from `applications.ts`; both are used at call time only, so ESM resolves the cycle.

## Verification

**Commands:**
- `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm -r run test` -- expected: all suites pass with the DB suites run.
- `pnpm -r run build && pnpm -r run typecheck && pnpm -r run lint && pnpm run boundaries` -- expected: exit 0 (run per package; root `turbo` may fail with "Exec format error").
- `pnpm -r run test` -- expected: passes, with the DB suites skipped.

## Auto Run Result

Status: done

**Summary:** A Builder can now download a Cursor Boilerplate for an Application from the New-application flow, and each Application records the agent tool it was last generated for.
- **Targets.** `BOILERPLATE_TARGETS` is `["claude-code", "cursor"]`. The panel's "Agent tool" select offers Claude Code (default) and Cursor.
- **Cursor archive.** Same request path and check order as Story 3.3; the archive holds the same three shared files, then `.cursor/mcp.json` (the same bridge entry plus Cursor's documented `type: "stdio"`), `AGENTS.md` (the exact `CLAUDE.md` content with the one path reference swapped) and `.cursor/skills/domain-harness-guidance/SKILL.md`. No hooks, no settings, no `.mdc` rules.
- **Agent-tool recording.** A successful generation appends one row of `application_agent_tool_changes` (migration 0011, append-only, RLS forced, SELECT and INSERT only). The current tool is the highest per-Application sequence; generating the current target writes nothing; any refusal writes nothing. `GET /v1/applications` answers it as `agentTool` (`null` when none).
- **Byte identity.** For the same Application, the identification file, `package.json` and `design-system.json` are byte-identical across both targets (proven at render level and over HTTP through the untar comparison).

**Files changed:**
- `packages/contract/src/boilerplate.ts`, `src/applications.ts` (+ tests): the `cursor` target and `agentTool` on `ApplicationInfo`.
- `apps/registry/migrations/0011_application_agent_tool.sql`, `src/db/schema.ts`: the append-only agent-tool table with forced RLS.
- `apps/registry/src/applications/agent-tool.ts`: `currentAgentTools` and `recordAgentTool` (same state writes nothing).
- `apps/registry/src/applications/service.ts`: `agentTool` in the list and create responses.
- `apps/registry/src/boilerplate/service.ts`: the target recorded as the last step of a successful generation.
- `apps/registry/src/boilerplate/render.ts` (+ tests, `src/index.ts`): shared instruction/skill bodies parameterised by the MCP config path; `renderCursorMcpJson`, `renderAgentsMd`, `renderCursorSkill`; the `cursor` target files.
- `apps/registry/src/boilerplate/boilerplate.db.test.ts`, `src/tenancy/tenancy.db.test.ts`, `src/http/server.test.ts`: every matrix row, the byte-identity proof, the table lists, the fixtures.
- `apps/panel/src/components/new-application.tsx`, `src/routes/new-application.test.tsx`, `src/registry.server.test.ts`, `src/routes/inventory.test.tsx`: the Cursor option and the fixtures.
- `tooling/boundaries/` (+ `.dependency-cruiser.cjs`): the scoped `no-circular` exemption for the blessed contract pair and the `contract-circular` fixture proving its scope.
- `README.md`: the Boilerplate section for both targets and the recording.

**Review findings:** 22 findings: high 0, medium 0, low 15, false 7.
- **Patched (low):** the sprint tracker (BH1/BH2/IA5); the `no-circular` exemption's missing proof (BH3/VG1); the untested panel path of choosing Cursor (BH4); the README's byte-identity under-claim and the two-of-three DB check (BH5); the cross-describe test coupling (BH8); the asymmetric panel guard test (BH9); the Standard-owner readback (BH11). Tests added: the contract-circular boundary proof, the panel choose-Cursor test, the create-path guard cases, the `sam` readback.
- **Deferred:** none.
- **Rejected:** 5 low and 7 false, each with its reason in the triage log.

**Follow-up review recommended: false.** Patched counts: high 0, medium 0, low 7 entries.

**Verification:**
- With `REGISTRY_TEST_DATABASE_URL` (local PostgreSQL 18): contract 265, core 61, registry 718, panel 363 passed + 1 skipped (pre-existing), boundaries 17, cli/service/collector/extractor 1 each — all suites green, none skipped in the DB suites.
- `pnpm -r run build`, `typecheck` and `lint` exit 0, and `pnpm run boundaries` reports no violations.
- Matrix audit: every row is covered by `boilerplate.db.test.ts` (Cursor describe and refusals), `render.test.ts` (byte identity, neutrality, path swaps) or the contract/panel suites, and each ran in the DB run.
- Patch round re-verified with the same commands after the fixes.

**Residual risks:**
- Choices made on the human's behalf:
  - The agent tool is recorded for every successful generation, including `claude-code` (target-agnostic recording).
  - `AGENTS.md` and the Cursor skill are the exact Claude content with one path swap; `.cursor/rules/*.mdc` was not used.
  - `.cursor/mcp.json` carries `type: "stdio"` (Cursor's table documents it as required; its own example omits it).
- Cursor's file formats are pinned from docs.cursor.com (fetched 2026-10-13), not executed against a real Cursor install.
- `ApplicationInfo` now requires `agentTool`; a newer panel against an older registry degrades the Applications list (the repo's strict-guard convention; panels and registries deploy together in the pilot).
- The contract now has one blessed import cycle (`applications.ts` ↔ `boilerplate.ts`, call-time-only), scoped by a boundary exception proven by the `contract-circular` fixture.
- An untracked `bmad-build-auto-result-5-1.md` (residue of a different run that resolved "next" as 5.1 and found a dirty tree) was left out of the story and removed after triage; its full content is recorded in this session's report.
- Tested on PostgreSQL 18 (Docker) and Node 22.
