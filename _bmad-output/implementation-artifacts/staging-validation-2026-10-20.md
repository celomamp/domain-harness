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
