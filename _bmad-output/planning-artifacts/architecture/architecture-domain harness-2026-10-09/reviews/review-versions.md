# Version reality-check: ARCHITECTURE-SPINE.md Stack table

Reviewed 2026-10-10. Read-only review of the spine. Sources fetched via web (nodejs.org, github.com/nodejs/Release, registry.npmjs.org, devblogs.microsoft.com/typescript, github.com/microsoft/TypeScript, github.com/microsoft/typescript-go, github.com/modelcontextprotocol/typescript-sdk, modelcontextprotocol.io, postgresql.org). Fetched pages were summarized by a small model, so exact figures marked "medium" should be re-checked with `npm view` / `node --version` at scaffold.

## Verdict

Node.js, TypeScript and PostgreSQL rows are sound; the MCP SDK row is stale and should be changed: v2 (`@modelcontextprotocol/server` and friends, latest 2.3.1) was released stable on 2026-07-27, so the spine's "pin v1.x because v2 is alpha/beta" is no longer true.

## Summary table

| Item | Confirmed state (2026-10-10) | Confidence | Recommended pin change |
| --- | --- | --- | --- |
| Node.js 24 | Active LTS since 2025-10-28; Maintenance starts 2026-10-20; EOL 2028-04-30 | High (nodejs/Release schedule) | None. Spine's "Active LTS until 2026-10-20" is correct. |
| Node.js 26 | Current since 2026-05-05; Active LTS scheduled 2026-10-28; Maintenance 2027-10-20; EOL 2029-04-30 | Medium-high (dates "subject to change"; not yet LTS today) | Keep "26 LTS target". Change "late October" to "scheduled 2026-10-28"; keep `engines >=24`. Do not claim LTS before that date. |
| Node.js 25 | EOL | High | None (not used). |
| TypeScript | 7.0 stable (blog 2026-07-08); npm `latest` = 7.0.2; `rc` = 7.0.1-rc; `next` = 7.1.0-dev; 6.0.x (6.0.3) is the last JS-codebase line | High for version; Medium for tooling | Change "7.x (fall back to 6.x if tooling lags)" to "7.0.x pinned exactly (7.0.2 or later), fallback 6.0.x". Remove "native compiler" hedging; add a scaffold check list (below). |
| @modelcontextprotocol/sdk | v1 package `@modelcontextprotocol/sdk` latest 1.32.1, on `v1.x` branch, security fixes only "at least six months after" 2026-07-27 (i.e. to ~2027-01-27 minimum). v2 on `main`, called stable, split packages `@modelcontextprotocol/server`, `/client`, `/node`, `/express`, `/fastify`, `/hono`; `@modelcontextprotocol/server` latest 2.3.1 | High (README + npm dist-tags) | Change to "v2: `@modelcontextprotocol/server` (+ `/node` or framework helper) 2.x, behind the MCP adapter". v1 is a fallback only, not the primary, because its maintenance window is short. |
| MCP transport for remote Guidance | Spec 2026-07-28 defines two standard transports: stdio and Streamable HTTP (single HTTP POST endpoint, JSON or request-scoped SSE reply). SDK v2 README lists Streamable HTTP and stdio. | High (spec), Medium (SDK class names not confirmed) | State explicitly in the spine: Guidance MCP is served over Streamable HTTP; stdio only for local dev. |
| PostgreSQL 18 | Supported; first release 2025-09-25; current minor 18.6; final release 2030-11-14 | High | None. Pin "18" is sound. |
| PostgreSQL 19 | Beta (Beta 4 announced 2026-09-24); not GA | High | Do not adopt for pilot. Revisit after GA and first minor. |
| Row-level security (AD-12) | Supported in 18 (docs section 5.9): `ENABLE`/`FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, default-deny with no policy | High | None. Add note: table owner and superuser/BYPASSRLS bypass RLS unless `FORCE` is set; app role must not own tables or have BYPASSRLS. |

## Per-row detail

### Node.js
- nodejs/Release schedule: 24.x Krypton: Active LTS 2025-10-28, Maintenance 2026-10-20, EOL 2028-04-30. 26.x: released 2026-05-05, Active LTS 2026-10-28, Maintenance 2027-10-20, EOL 2029-04-30. 25.x EOL.
- nodejs.org previous-releases page lists v26 as "Current", v24 "LTS", v22 "LTS". One column on that page showed "Oct 07, 2026" for v26; it is a "last updated" date, not an LTS start, per the schedule repo.
- Spine claim "24 Active LTS until 2026-10-20; 26 enters LTS late October" is correct. As of today (2026-10-10) 26 is still Current, so "26 LTS target" is a forward statement; it becomes true in about 18 days.
- Soundness: `engines >=24` is fine. Risk: if the 2026-10-28 date slips, 24 is still supported (Maintenance until 2028-04-30), so the fallback is safe.
- Note the release page says the odd/even six-month cadence still applies on the page fetched; I could not confirm any announced cadence change (not asserted by the spine, so not a finding).

### TypeScript
- Blog timeline: 6.0 beta 2026-02-11, RC 2026-03-06, final 2026-03-23 ("last release based on the current JavaScript codebase"). 7.0 beta 2026-04-21, RC 2026-06-18, stable 2026-07-08, "10x faster native port" (Go).
- npm dist-tags: latest 7.0.2, rc 7.0.1-rc, beta 6.0.0-beta, next 7.1.0-dev.20261010.1.
- GitHub release 7.0.2 dated 20 Aug (2026); a VS Code extension 1.0.1 bundles 7.0.2 (30 Sep).
- typescript-go README (repo archived, moved into main TypeScript repo) says: for 7.0 RC and later the command is `tsc`; type checking, JSX, declaration emit, JS emit, watch, build mode/project references, incremental all done. The same page said the compiler **API is "not ready"** and language service "in progress"; it may be outdated relative to the stable release. I could not confirm from an authoritative source whether the programmatic API shipped in 7.0.x stable.
- Ecosystem compatibility NOT confirmed: typescript-eslint latest is 8.71.1 on npm, but I did not verify its supported TypeScript range or 7.x support. Also not confirmed: ts-node, ts-jest, vitest, tsup, tsx, API Extractor, ts-morph, any tool using the compiler API or tsserver plugins.
- Spine soundness: pin is sound (7 is stable, 6.0.x exists as a fallback). The hedge "native compiler; fall back to 6.x if tooling lags" is reasonable. Recommend making the fallback a concrete scaffold gate: (1) lint tooling (typescript-eslint) accepts 7.0.x; (2) test runner and bundler/transpiler work; (3) any package that imports the `typescript` compiler API (codegen, schema/JSON-schema generators, doc tools) works; (4) declaration emit differences do not break `packages/contract` published types (README notes declaration emit differs intentionally).
- Relevance to this spine: `packages/contract` emits types consumed by the CLI and Company service, so declaration-emit behavior is the highest-risk item.

### MCP TypeScript SDK
- Spine says "1.x ... v2 split packages were alpha/beta in docs checked 2026-10-09". This is outdated or incorrect: the SDK README (main branch = v2) describes v2 as "the stable release line", released 2026-07-27, implementing the 2026-07-28 MCP spec; `@modelcontextprotocol/server` latest on npm is 2.3.1.
- v1 (`@modelcontextprotocol/sdk`, latest 1.32.1) is on `v1.x` and gets fixes for "at least six months" after 2026-07-27. Starting a new build on v1 in October 2026 buys a maintenance cliff near the pilot.
- Packages: `@modelcontextprotocol/server` (`McpServer`), `/client`, `/node` (Node Streamable HTTP wrapper for `IncomingMessage`/`ServerResponse`), `/express`, `/fastify`, `/hono` (framework helpers incl. Host header validation). Migration guide: ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2 (not fetched; a GitHub docs path I guessed returned 404).
- Transport: MCP spec 2026-07-28 standard transports are stdio and Streamable HTTP. The spec's backward-compat section notes earlier revisions had an `initialize`-handshake session and server-initiated requests; the 2026-07-28 revision removes server-initiated JSON-RPC requests and carries protocol version and capabilities per request. Consequence for the spine: a remotely hosted Guidance endpoint is Streamable HTTP; AD-15's request/response tools fit this model (no server-initiated requests needed). Verify clients (agent tools) in the pilot negotiate 2026-07-28 or fall back to the older handshake; this was not verified.
- Not confirmed: exact SDK minimum Node version for v2, exact Streamable HTTP class names in v2, whether HTTP+SSE legacy server transport is removed. The README did not say.
- Spine fit: the spine already keeps the SDK "behind the MCP adapter", which keeps the v1-to-v2 choice cheap to change. Good.

### PostgreSQL
- postgresql.org versioning: 18 is current major (18.6), released 2025-09-25, supported to 2030-11-14. 17.11, 16.15, 15.19, 14.24 (14 EOL 2026-11-12).
- 19: Beta 4 announced 2026-09-24. Not GA. The usual cadence puts GA around late September, but it had not been released as of the fetched page. Not confirmed whether GA is imminent.
- RLS: documented in the 18 manual; supported since 9.5, so no version risk. Gotchas for AD-12: owner/superuser/BYPASSRLS bypass; referential integrity checks bypass RLS (relevant to cross-tenant FK leakage and unique-key probing); `TRUNCATE`/`REFERENCES` not subject to RLS; with no policy, access is default-deny.
- "Managed Postgres" on the vendor side: I did not verify that a specific managed provider offers 18; not asserted by the spine as a provider, but the "Cloud provider" is Deferred, so check provider support for 18 at that decision.

## Flagged: asserted but not confirmed from an authoritative source

1. TypeScript 7 ecosystem compatibility (typescript-eslint, test runners, bundlers, compiler-API consumers): not verified.
2. TypeScript 7.0.x stable compiler API availability: typescript-go README said "not ready"; stable status unknown.
3. MCP SDK v2 details: Node minimum, Streamable HTTP class names, stateless mode, SSE removal: not verified.
4. MCP clients' support for spec 2026-07-28 (agent tools used by Builders): not verified.
5. Node 26 LTS date 2026-10-28 is a schedule, "subject to change", and in the future relative to today.
6. Spine text "docs checked 2026-10-09" for v2 alpha/beta: contradicts the README now fetched; cannot reproduce which docs said so. Likely an older docs page or a prerelease tag.
7. PostgreSQL 19 GA timing: only beta status seen.
8. Page-summaries were produced by an intermediate summarizer; treat exact dates as medium-high until re-confirmed with `npm view`, `node -v`, and `SELECT version()`.

## Suggested Stack table replacement

| Name | Version |
| --- | --- |
| Node.js | 26 LTS target (Active LTS scheduled 2026-10-28), `engines >=24` (24 is Active LTS until 2026-10-20, then Maintenance to 2028-04-30) |
| TypeScript | 7.0.x (native compiler, `latest` 7.0.2); fall back to 6.0.x only if a scaffold-time tooling gate fails (lint, test, declaration emit, compiler-API consumers) |
| MCP SDK | v2: `@modelcontextprotocol/server` 2.x (+ `/node` or a framework helper), behind the MCP adapter; Streamable HTTP for the remote Guidance endpoint. v1 `@modelcontextprotocol/sdk` 1.x only as fallback |
| PostgreSQL | 18 (18.x current minor); row-level security supported; 19 is beta, not adopted |
