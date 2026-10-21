# Staging validation — end-to-end against the pilot user guide

Date: 2026-10-20 · Target: `https://dh-panel-staging.fly.dev` (main at `ead612b`)
Method: followed `docs/guia-do-usuario` section by section (and its §16 test script per role) in a browser, signed in with the three demo accounts of the "Demo Pilot" Company. Test data carries the prefix `VAL` so it can be told apart.

## Verdict

The **panel side of the loop works end to end** for all three roles. The **agent side of the loop (Builder's agent → Guidance MCP → Gate → evidence back in the panel) cannot be exercised by a pilot today**: three blockers below. A pilot can be invited for the governance half (§07–§14 of the guide), not yet for §11's "the agent already consults the Standards" or §12's evidence.

## Steps exercised

| Guide § | Role | Step | Result |
| --- | --- | --- | --- |
| 05 | all | Demo sign-in (Buyer, Standard owner, Builder), sign out | Pass |
| 07 | Buyer | Create `VAL Cartoes` (level "Unidade de negocio") and child `VAL Portal do Cliente` (level "Produto") | Pass |
| 08 | Buyer | Create code-stack Module `VAL Stack Frontend` and design-system Module `VAL Design System`; assign Demo Standard owner to both | Pass; "Without an owner" counter went 1 → 0 |
| 09 | Standard owner | Publish TypeScript (required), moment (prohibited, with correction), recharts `^2` (approved, scoped to VAL Cartoes) | Pass |
| 09 | Standard owner | Edit moment → version 2 | Pass |
| 09 | Standard owner | Publish a second "moment" in the same slot | Refused correctly, message names the blocking Standard |
| 09 | Standard owner | Design-system component `PrimaryButton` with usage rule | Pass |
| 10 | Buyer | Effective standards on `VAL Portal do Cliente` | Pass: inherited root Standards + recharts from VAL Cartoes, correct Source Project |
| 10 | Buyer | Mark TypeScript as Locked rule on root | Pass; tree shows "1 Locked rule" |
| 10 | Buyer | Build grant to Demo Builder on `VAL Portal do Cliente` | Pass |
| 11 | Buyer | Set Guidance endpoint | Pass only with an https URL (see finding 2) |
| 11 | Builder | Place an Application on VAL Cartoes (no grant) | Refused correctly: "You have no build grant on VAL Cartoes…" |
| 11 | Builder | Place `VAL Portal de faturas do cliente` on VAL Portal do Cliente, generate Claude Code Boilerplate | Pass; archive contents checked (below) |
| 12 | Buyer | Inventory, Application evidence page, Compilations | Pages render; evidence and Compilations empty (expected — see finding 3) |
| 13 | Buyer | Grant Standard owner read access, retention 90 → 30, save; mint read token | Pass; token shown once with a 5-minute expiry |
| 14 | Buyer | Paste a Gate deviation line, record an Accepted deviation (30-day window, 24 h alerts) | Pass; resolved Standard version 2, listed as Active. The line was **synthetic** (official grammar, real Standard id) because no Gate could run — see finding 3 |
| 15 | Buyer | Inventory at 375 px | Pass; no horizontal page scroll |

Boilerplate archive (Claude Code) contained `.domain-harness.json`, `package.json` (typescript pinned), `design-system.json` (PrimaryButton), `.mcp.json`, `CLAUDE.md` (required/approved/prohibited lists correct, recharts with `^2`), and `.claude/skills/domain-harness-guidance/SKILL.md`.

Service side (`fly status` / `fly logs`): all four apps running; the daemon logs a `bundle_cycle` every 60 s (`pinned`, unchanged hash) for the staging tenant `01a155c3…`; guidance started on `/mcp`.

## Findings

### Blockers for a real pilot

1. **`@domain-harness/mcp-bridge` is not published on npm.** The generated `.mcp.json` runs `npx -y @domain-harness/mcp-bridge <endpoint>`; `npm view` returns 404. A Builder who unzips the kit gets an MCP server that fails to start, so the agent never consults the Standards. `@domain-harness/cli` (the offline Gate the README installs with `npm install -g`) is also 404 on npm.
2. **No Guidance endpoint a Builder's laptop can use.** The panel only accepts `https://` URLs, while the staging runbook defines the guidance server as private `http://dh-guidance-staging.internal:8080`. The endpoint was set to `https://dh-guidance-staging.internal/mcp` to continue, but that name only resolves inside Fly's network, so it is unreachable from a pilot's machine. There needs to be a decided, reachable (and authenticated) endpoint for pilots.
3. **"Demo Pilot" has no Company service.** The daemon and guidance apps are provisioned for the staging tenant `01a155c3…`, not for Demo Pilot. Demo Pilot therefore never gets a bundle, a Guidance event, a Gate run or a Compilation, and Inventory/Application evidence/Compilations stay empty for every demo user — exactly the screens §12 asks pilots to look at.

### Security / ops

4. **The guidance app has public IPs** (`fly ips list --app dh-guidance-staging`: dedicated IPv6 + shared IPv4, created 2026-10-19), contrary to `docs/staging.md` ("must stay empty"). `GET https://dh-guidance-staging.fly.dev/mcp` answers 405 from the internet, so the MCP endpoint is publicly reachable. Either release the IPs (`fly ips release`) or, if this is the intended answer to finding 2, put authentication in front and update the runbook.
   **Resolved 2026-10-20:** both IPs released; `fly ips list` is empty, `dh-guidance-staging.fly.dev` no longer resolves, and the app's Machine keeps running with its check passing.

### Guide gaps and UX notes

5. The Collector cannot send until the Buyer clicks **"I have read catalog 1.0.0"** in Compilations → Schemas. The guide never mentions this step; add it to §12 and to the Buyer checklist in §16.
6. Design-system components show status **"None"** in Effective standards (the component form has no status field). Reads as missing data.
7. Builders see the Buyer-only **Company setup** box (Guidance endpoint form) in New-application flow.
8. The prohibited Standard's correction instruction ("use date-fns…") does not appear in the generated `CLAUDE.md`, only the bare "Prohibited: library moment".
9. The Create project drawer renders semi-transparent over the page, so the page content shows through behind the form.

## Test data left on staging (Demo Pilot)

Projects `VAL Cartoes`, `VAL Portal do Cliente`; Modules `VAL Stack Frontend`, `VAL Design System` with 4 Standards; Locked rule on TypeScript; build grant for Demo Builder; Guidance endpoint `https://dh-guidance-staging.internal/mcp`; Application `VAL Portal de faturas do cliente`; one Accepted deviation (until 2026-11-20); Guidance access: Standard owner granted, retention 30 days; catalog 1.0.0 marked read.

## Follow-up the same day: pilot agent loop (option A)

Blockers 1–3 were addressed and the agent half of the loop was run end to end on staging:

- **Endpoint (2):** the guidance server takes an optional `SERVICE_GUIDANCE_ACCESS_TOKEN`; with it, `/mcp` answers 401 without the Bearer token. The app has public IPs again and the panel's Guidance endpoint is `https://dh-guidance-staging.fly.dev/mcp`. Checked from the internet: no token 401, wrong token 401, right token 200.
- **Bridge distribution (1):** GitHub Release `pilot-0.1` carries self-contained `mcp-bridge.tgz` and `cli.tgz` (`tooling/release/pack-pilot.sh`); Boilerplates now run the bridge from that URL (`REGISTRY_MCP_BRIDGE_PACKAGE`). Two real defects surfaced and were fixed: the bridge and the CLI did nothing when started through an installed bin symlink (npx / `npm install -g`).
- **Demo Pilot service (3):** the daemon and the guidance server now serve the Demo Pilot tenant with a newly minted service credential.

End-to-end results:

| Step | Result |
| --- | --- |
| New Application placed and Claude Code kit generated; `.mcp.json` points at the release tarball and the public endpoint | Pass |
| MCP client starts the bridge exactly as `.mcp.json` says, with `DH_GUIDANCE_TOKEN` | Pass: 4 tools listed; moment → prohibited with the v2 correction; recharts → approved `^2`; lodash → miss (gap); PrimaryButton → usage rule |
| Same without the token | Refused |
| Guidance events reach the panel | Pass after two fixes (below): Collector flush `sent 4`, Application evidence shows 4 Guidance entries, Inventory "Evidence received" |
| Offline Gate with the CLI installed from the release | Runs; `moment` reported with the authored correction |

New findings from this run:

10. **The Collector was never wired into the deployed service** — no Guidance event or Gate run could ever reach the panel. Fixed for Guidance events (guidance server enqueues to the outbox, 30 s flusher).
11. **Boilerplate generation did not rebuild the bundle**, so a freshly generated Application had no agent tool in the bundle and the Collector skipped all its events. Fixed (generation now builds the bundle; the bundles DB test was updated from the old pinned behavior).
12. **The Gate matches code-stack Standards to packages by exact, case-sensitive name** (`packages/core/src/evaluate.ts`, documented as a design choice), while Guidance matches casefold. A Standard named "TypeScript" (the guide's example) is never satisfied by the `typescript` package, so a fresh kit **fails** the Gate; and a prohibited "React" would **not** catch `react`. **Resolved 2026-10-21:** code-stack matching is now casefold (trimmed, NFC, lowercase) in the core, as in Guidance; released in `pilot-0.2`. On staging the kit's "TypeScript" is met by `typescript`, `moment` is still caught, and the revision without it passes.
13. **Gate runs still never reach the panel:** the CI Gate (`apps/service/src/ci-gate/gate-cli.ts`) has no Collector, needs the Company record store, and needs a pre-resolved snapshot file nothing produces; the offline CLI records nothing. In the hosted pilot model the Builder's CI cannot reach the record store, so Gate evidence needs a design (e.g. a token-gated Gate-run ingest on the guidance server). **Resolved 2026-10-21** (PR #2, see below).
14. One `npx` start of the bridge timed out once (download), then worked; first-run latency of `npx <tarball URL>` is worth noting for pilots.
15. An orphan service-credential row exists for Demo Pilot (a first mint whose value was lost); harmless, nobody holds the token.

## Follow-up 2026-10-21: hosted Gate runs (finding 13)

Decisions put to the user first: evaluation is **server-side** (the server's bundle, acceptances and staleness are authoritative; the verdict is not self-reported), and the revision's **facts may leave the Company in the hosted pilot** (dependency names and versions, import specifiers, design-token names; never file contents or paths), documented as a pilot-only exception.

Built (PR #2): `POST /v1/gate-runs` on the guidance server behind the `/mcp` Bearer gate (Story 4.3 identity on the shared bindings, `joinEffectiveSet`, `runGate`, `gate_runs` append, Collector enqueue), and `domain-harness gate --endpoint <url>` in the CLI, released as `pilot-0.3`. The guidance app was deployed by hand from the PR branch (release v7). The pilot access token was **rotated** on 2026-10-21 (the old value could not be recovered); every Builder must update `DH_GUIDANCE_TOKEN`.

| Step | Result |
| --- | --- |
| Gate-run route from the internet: no token / wrong token / new token with an empty body | 401 / 401 / 400 `invalid_input` |
| Hosted Gate, revision `4c4652c` of the bound "VAL E2E agente 2" repo with `moment` added (CLI from the branch) | `fail`, exit 1, **two** Deviation lines: moment (code-stack, authored correction) and moment (design-system PrimaryButton allow-list, finding 16) |
| Server log | `gate_run` with id, kind and counts only (`checked 4, open 2`); `collector_flush sent 1` 9 s later |
| Application page | Pass: "No Gate run yet" replaced by Gate verdict fail, 2 open, Adherence 2 of 4; History "Gate run, Sequence 5" |
| Accept the moment code-stack Deviation from its row (Buyer) | Pass: Accepted deviation recorded, 21 Oct to 21 Nov 2026, alert 24 h; daemon activated bundle 22 a minute later |
| Same revision again, `pilot-0.3` CLI from the release tarball | `fail`, exit 1, one line (PrimaryButton) — moment no longer reported; panel shows the moment row **accepted** ("End date 2026-11-21"), 1 open, Adherence 3 of 4, Gate run Sequence 6 |

New findings:

16. **Any import fails the component allow-list once a design system has a component Standard.** `evaluateDeviations` (`packages/core/src/evaluate.ts`, component allow-list) treats the last path segment of *every* import specifier as a component use, so `moment` — and `react`, `date-fns`, any npm import — is a Deviation of the `PrimaryButton` Standard in "VAL Portal do Cliente". The hosted Gate faithfully reproduces it (the offline CLI and CI Gate share the evaluator), but it means no real revision of that Project can pass. The allow-list should only consider imports from the design system's own package(s). **Resolved 2026-10-21** (PR #3): component use is now detected only under the specifier of a *required* design-system import entry (`<root>/<Name>`, last segment, case-insensitive); npm libraries, relative paths and the bare root never count, and a set with no required import entry detects no component. No contract change. Known gap: `ImportFact` carries no imported names, so `import { PrimaryButton } from "@acme/ui"` is still invisible to the allow-list; staging's VAL Design System needs a required import entry for its package before the allow-list checks anything.
17. The Accept link on the Application page did not navigate on a click from the built-in browser once (opened directly by its URL); not reproduced further, worth a look.

Test data added on staging (Demo Pilot): two Gate runs and one Accepted deviation (moment, until 2026-11-21) on "VAL E2E agente 2 (evidencia)".
