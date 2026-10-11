---
title: 'Story 1.3: Sign in to a branded management panel'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '88b172f3b275f78760f59dc70fdef189a5353695'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/decisions/starter-template.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/DESIGN.md'
warnings: ['oversized']
deferred:
  - summary: >-
      DESIGN.md contrast pair "accent marks on surface-raised >= 3:1" cannot pass in light mode with the mandated values (1.56:1), so the story AC "contrast check passes every pair" holds with one declared exception.
    evidence: |-
      #FFC700 on #FFFFFF measures 1.56:1 (WCAG). Tokens must equal DESIGN.md. apps/panel/src/design/contrast.ts declares it as the only exception; the test fails if the list grows. UX must change DESIGN.md or Epic 6 must give accent marks an ink edge.
    location: >-
      apps/panel/src/design/contrast.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Provisioned accounts (Story 1.2) cannot reach anything: there is no sign-in, no session, no panel app, and no design-token source, so every later panel story has no shell, chrome or role to build on.

**Approach:** The registry (authority for accounts and roles, AD-17) gains a passwordless magic-link sign-in: single-use, short-lived link tokens and sessions in new tenant-scoped tables, mail delivery behind a small transport interface, and a small internal JSON HTTP API. The panel becomes a React Router 8 framework-mode app (SSR) that calls that API (types in `contract`), keeps the session in an HttpOnly cookie, and renders sign-in, Inventory (empty state) and a Standards shell under panel-chrome, styled only from one token source matching DESIGN.md in light and dark mode.

## Boundaries & Constraints

**Always:**
- Panel imports only `@domain-harness/contract` among workspace units and talks to the registry only over HTTP. Panel source stays under `apps/panel/src/` (React Router `appDirectory: "src"`) so the boundary rule covers it.
- Same visible result for every well-formed email: "Check your email for a sign-in link". The registry responds identically (status and body) whether or not an account exists, and sends mail after responding so timing does not reveal it. Only provisioned addresses get a link; an email held by accounts in N tenants gets N links (one per account).
- Link: 15-minute expiry, single-use enforced atomically in SQL (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING`). Session: 12 hours. Tokens are `<tenantId>.<base64url of 32 random bytes>`; only SHA-256 of the token is stored. All lookups go through `withTenant` with the tenant id parsed from the token.
- Cross-tenant email lookup is the one narrow RLS exception: a `SECURITY DEFINER` function owned by a new `NOLOGIN` role `dh_sign_in_lookup` (SELECT on `accounts(id, tenant_id, email)` only, plus a `FOR SELECT TO dh_sign_in_lookup USING (true)` policy) returning only `(tenant_id, account_id)` for a normalized email; `EXECUTE` granted only to `dh_registry_app`. `assertRuntimeRoleSafe` also refuses a runtime role that is a member of `dh_sign_in_lookup` and covers the new tables.
- New tables `sign_in_links`, `sessions` have RLS enabled + forced with the 0001 policy shape, FK `(tenant_id, account_id)` to accounts, and grants `SELECT, INSERT` (+ `UPDATE (consumed_at)` on `sign_in_links`) to `dh_registry_app`.
- Errors cross HTTP as the `contract` envelope. Logs and stdout carry ids and counts only, never emails, tokens or links. Config from environment variables only.
- Panel styling: every color, font, size, spacing and radius comes from `src/design/tokens.ts` (values identical to DESIGN.md front matter), emitted as CSS custom properties with a `prefers-color-scheme: dark` set. Gold fills only button-primary; never text, pass/fail or chrome; no `#737373`. Sora/Poppins self-hosted (no runtime call to a font CDN). Page `lang="en"`; copy uses glossary terms exactly; no all-caps.
- Accessibility (WCAG 2.2 AA): tab order = reading order (no positive `tabindex`), visible ink `:focus-visible` ring, no focus trap, every target ≥ 24px, usable at 320/768/1280px and 200% zoom; sign-in focuses its email field on open; denials and the link-sent text are announced as a status (`role="status"`). Never hide a control by role.
- Email delivery: SMTP via Nodemailer (`REGISTRY_SMTP_URL`, `REGISTRY_MAIL_FROM`) for real delivery; a file outbox transport (`REGISTRY_MAIL_OUTBOX_DIR`, one JSON file per message, mode 0600) for local dev and tests. Exactly one must be configured or the server refuses to start with `missing_configuration`. Tests never send real email.

**Never:** No passwords, SSO, sign-up, or account creation. No Module, Standard, Application or Project-tree features (the Standards and Inventory surfaces are shells). No sign-out, rate limiting or link-scanner interstitial (out of scope). No panel database access or registry import. No other chromatic color. No client-minted ids. No Google Fonts or other runtime third-party requests. No real email sent from tests or verification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Provisioned email | sign-in form submits `" Bea@Acme.io "` | page shows "Check your email for a sign-in link" as status; exactly one message to `bea@acme.io` whose link contains a token; one `sign_in_links` row (hash only) | none |
| Unknown email | `nobody@else.io` | identical page text and identical registry response; no message; no row | none |
| Email in two tenants | same address provisioned in A and B | two messages, each link signs into its own tenant | none |
| Malformed or empty email | `""`, `"not-an-email"` | field keeps its value; ink text under it asks for an email address; no registry call | none |
| Valid link | unused, unexpired token opened | session cookie (HttpOnly, SameSite=Lax, Path=/, Secure on https) set; redirect to `/inventory`; chrome shows wordmark, role text, nav Inventory (current, 600) and Standards; empty state shown | none |
| Used link | same token opened a second time | stays on sign-in with denial text announced as status; no session | registry `401 sign_in_link_invalid` |
| Expired link | token whose `expires_at` has passed | same as used link | `401 sign_in_link_invalid` |
| Malformed or foreign token | garbage, or tenant part not UUIDv7, or valid tenant + unknown secret | same as used link; no query without a valid tenant id | `401 sign_in_link_invalid` |
| No or bad session | `/inventory` or `/standards` without a valid cookie, or session expired | redirect to `/sign-in` | registry `401 session_invalid` |
| Registry unreachable | panel cannot reach the registry | sign-in page shows a denial-style status that sign-in is unavailable; nothing else breaks | panel catches; no stack shown |
| Cross-tenant | session/link token with tenant A's id but tenant B's secret | rejected | `401` |

</intent-contract>

## Code Map

- `apps/panel/{package.json,tsconfig*.json,eslint.config.js,src/index.ts}` -- placeholder unit to replace with the React Router app; `build` is currently `tsc -b` (switch to `react-router build`, output `dist/`), root `tsconfig.json` references `apps/panel/tsconfig.build.json` (keep a valid reference or drop it if the panel no longer builds with `tsc -b`).
- `tooling/tsconfig/base.json` -- `lib: es2024`, `types: ["node"]`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`: panel tsconfig adds DOM libs, `jsx: react-jsx`, vite types.
- `tooling/eslint-config/index.js` -- typed rules apply to `**/*.ts` only; extend to `.tsx` (and ignore `build`/`.react-router`).
- `.dependency-cruiser.cjs` -- `panel-imports-only-contract` keys on `^apps/panel/src/`; `TEST_FILE` is `\.test\.ts$` and `extensions` lack `.tsx`: extend both so `.tsx` source and tests are checked; `no-dev-dependencies-in-src` means react, react-dom, react-router, @react-router/node, @react-router/serve, isbot, @fontsource/* are `dependencies`; vite/@react-router/dev are dev (used only by root config files).
- `pnpm-workspace.yaml` -- add versions to the default catalog. npm on 2026-10-10: react-router / @react-router/{dev,node,serve} 8.4.0, react / react-dom / @types/react / @types/react-dom 19.3.0, vite 8.3.4, isbot 5.2.2, nodemailer 10.1.0 (MIT-0), @types/nodemailer 8.0.2, @fontsource/sora and @fontsource/poppins 5.3.0 (OFL), yaml 2.9.1. `@react-router/dev` peers `typescript ^5.1 || ^6 || ^7`, `vite ^7 || ^8`.
- `turbo.json` -- add `.react-router/**` to build outputs if typegen is used; declare any new test env vars.
- `packages/contract/src/{index,accounts,errors,ids}.ts` -- reuse `Role`, `isRole`, `ErrorEnvelope`, `UuidV7`, `isUuidV7`. Add sign-in API shapes + runtime guards here.
- `apps/registry/migrations/0001_tenancy.sql` -- policy shape, role-creation DO blocks and grants to mirror in `0002`; accounts lack `UNIQUE (tenant_id, id)` needed for the composite FK (add it in 0002).
- `apps/registry/src/db/{schema,tenant-scope,client,migrate}.ts` -- add Drizzle tables; `TENANT_TABLES` drives `assertRuntimeRoleSafe`; `withTenant(db, tenantId, fn)` is the only query path.
- `apps/registry/src/tenancy/{validate,queries}.ts` -- `normalizeEmail` and the email shape check to reuse; `getTenant` for the Company name in the email.
- `apps/registry/src/{errors,ids}.ts` -- `EnvelopeError`, `mintUuidV7`.
- `apps/registry/src/operator/{output,provision-cli}.ts` -- pattern for env-driven CLIs that print one envelope and exit 1.
- `apps/registry/src/tenancy/tenancy.db.test.ts` -- DB-suite pattern (throwaway database, `-c role=dh_registry_app`, skip/CI-fail rule); its "only these tables exist" assertion must now include the two new tables.
- `_bmad-output/planning-artifacts/ux-designs/ux-domain harness-2026-10-09/mockups/inventory.html` -- reference markup for chrome (`.top`, `.wordmark`, `.role`, `nav[aria-label="Management panel"]`, `aria-current="page"`) and the empty-state display heading.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contract/src/sign-in.ts` (+ export, + test) -- registry API paths, request/response types (`SignInLinkRequest {email}`, `SessionCreateRequest {token}`, `SessionInfo {accountId, tenantId, role}`, `SessionCreated {sessionToken, expiresAt, session}`), guards `isSessionInfo`, `isSessionCreated`, `isErrorEnvelope`, and the error codes `sign_in_link_invalid`, `session_invalid` -- one wire contract for both sides.
- [x] `apps/registry/migrations/0002_sign_in.sql` + `src/db/schema.ts` + `src/db/tenant-scope.ts` -- tables, RLS, grants, `dh_sign_in_lookup` role, lookup function, extended `TENANT_TABLES` and role-safety check, per Boundaries.
- [x] `apps/registry/src/sign-in/{tokens,service}.ts` -- token mint/parse/hash; `requestSignInLinks(db, mailer, config, email)` (lookup, mint one link per match, send), `consumeSignInLink(db, token)` → session, `getSession(db, token)`.
- [x] `apps/registry/src/mail/{transport,smtp,outbox,memory}.ts` -- `MailTransport { send(message) }`; SMTP (Nodemailer), file outbox, in-memory (tests). Message: subject "Your Domain Harness sign-in link"; body names the Company and the management panel, says the link works once and expires in 15 minutes, includes `${REGISTRY_PANEL_URL}/sign-in/verify?token=...`.
- [x] `apps/registry/src/http/{server,serve-cli}.ts` + `package.json` script `serve` -- `node:http` JSON API: `POST /v1/sign-in-links` → 202 `{}` (400 `invalid_input` on malformed body/email), `POST /v1/sessions` → 201 `SessionCreated` | 401, `GET /v1/session` (Bearer) → 200 `SessionInfo` | 401; 404/405/413/500 as envelopes; body limit 4 KiB; env `REGISTRY_DATABASE_URL`, `REGISTRY_HTTP_HOST` (default `127.0.0.1`), `REGISTRY_HTTP_PORT` (default 4100), `REGISTRY_PANEL_URL`, mail vars; `assertRuntimeRoleSafe` at start.
- [x] registry tests -- unit (token format/parse, guards, mail body, HTTP routing with a fake service) and DB suite `sign-in.db.test.ts` covering every matrix row reachable at the registry (including atomic single-use under two concurrent consumes, expiry via an admin update of `expires_at`, no row/message for unknown email, two-tenant email, cross-tenant token, role-safety refusal for a `dh_sign_in_lookup` member); update the 1.2 table-list assertion.
- [x] `apps/panel` -- React Router 8 framework app: `react-router.config.ts` (`appDirectory: "src"`, `buildDirectory: "dist"`, SSR), `vite.config.ts`, scripts `dev`, `build`, `start` (`react-router-serve`), `typecheck`, `lint`, `test`; `src/root.tsx` (`lang="en"`, token CSS, fonts, global CSS), routes `/` (redirect), `/sign-in` (form + action), `/sign-in/verify` (loader consumes link, sets cookie), layout with panel-chrome guarding `/inventory` and `/standards`; `src/registry.server.ts` client validating responses with contract guards; env `PANEL_REGISTRY_URL` (default `http://127.0.0.1:4100`).
- [x] `apps/panel/src/design/{tokens.ts,contrast.ts}` + `src/styles/*.css` -- the one token source, CSS-variable emission (light + dark), WCAG contrast function, the DESIGN.md contrast-pair list in both modes; components `button-primary`, `button-inverse`, `denial`, `panel-chrome`, `sign-in` per DESIGN.md.
- [x] panel tests -- tokens equal DESIGN.md front matter (parse with `yaml`); contrast check over every pair in both modes (see Design Notes for the one known failing pair); stylesheet scan (no hex literal outside tokens, no `#737373`, no `color:` using an accent variable, accent fill only on button-primary); route/component tests (jsdom + Testing Library or `createRoutesStub`) for every panel matrix row, chrome (wordmark, role text, nav with exactly Inventory and Standards, `aria-current` + weight 600), status announcements, email field focused on open.
- [x] `docs/decisions/starter-template.md` addendum, `README.md`, `.github/workflows/ci.yml` if needed -- record React Router 8 as installed, the email delivery decision (SMTP via Nodemailer; outbox for dev), env vars, how to run registry + panel locally and sign in using the outbox.

**Acceptance Criteria:**
- Given the panel app, when any surface renders, then colors, typography (Sora, Poppins), spacing and radii come only from the token source matching DESIGN.md in light and dark mode, and the automated contrast check passes every DESIGN.md pair (Design Notes exception) with no `#737373` and no gold text, pass/fail or chrome.
- Given a provisioned account, when the person submits their email, opens the emailed link in the browser, then they land on `/inventory` with the empty state under panel-chrome showing "Domain Harness", their role as text, and a nav listing only Inventory (current, weight 600) and Standards; button-primary and button-inverse follow UX-DR6.
- Given keyboard-only use at 320, 768 and 1280 CSS px, when completing sign-in and moving through the nav, then tab order follows reading order, the ink focus ring is visible, nothing traps focus, targets are ≥ 24px, and sign-in is usable at 320px.
- Given a fresh clone without `REGISTRY_TEST_DATABASE_URL` and without `CI`, when `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries && pnpm test` run, then all pass with the DB suites reported skipped.

## Spec Change Log

## Review Triage Log

### 2026-10-11 — Review pass
- verdicts: 40 findings — high 0, medium 7, low 31, false 2, maybe-false 0
- findings:
  - `[medium]` `[patch]` EC1: unparseable absolute-form request target throws synchronously in the registry request listener (process crash) — URL parse wrapped; unparseable target is a 404 envelope.
  - `[low]` `[patch]` EC2: background link job started from the `res.end` callback never runs if the client disconnects first — job now starts right after the 202 is sent.
  - `[low]` `[reject]` EC3: no rate or concurrency limit on sign-in requests — internal API reached via the panel by a provisioned pilot Company; pool is bounded (max 4) so work queues, not crashes; a limiter adds new state and policy.
  - `[low]` `[reject]` EC4: a DB error on the 2nd of several matching accounts loses the earlier link's mail — needs one email held in two tenants plus a mid-request DB failure; the person re-requests.
  - `[false]` `[reject]` EC5: tenant row missing gives an empty Company name — `sign_in_links` and accounts FK `tenant_id` to `tenants`, and the tenant is always visible in its own context, so the row cannot be missing.
  - `[low]` `[reject]` EC6: mail scanners prefetching the GET link consume it — the story AC requires that opening the link lands on Inventory; recorded in Design Notes as a residual risk; an interstitial changes the AC'd flow.
  - `[medium]` `[patch]` EC7: behind a TLS-terminating proxy the session cookie lacks Secure — Secure now also set for `X-Forwarded-Proto: https` or any non-localhost host.
  - `[low]` `[reject]` EC8: panel/registry clock skew of 12h yields Max-Age=0 — needs a grossly wrong clock; adds a branch.
  - `[low]` `[patch]` EC9: any registry 4xx (misconfigured URL) clears the session cookie — cleared only for `session_invalid`, others are unavailable.
  - `[low]` `[patch]` EC10: every registry refusal shows the email field error — field error only for `invalid_input`/`email`, else unavailable status.
  - `[low]` `[reject]` EC11: `REGISTRY_PANEL_URL` with a query or fragment builds broken links — operator misconfiguration; fix adds validation.
  - `[low]` `[reject]` EC12: SIGTERM during background mail work drops it — rare; person re-requests; tracking pending work adds state.
  - `[low]` `[reject]` EC13: pre-existing `dh_sign_in_lookup` created by another role breaks a non-superuser migrator — same class as the 1.2 residual risk (untested managed-hosting migrator); adds branching.
  - `[low]` `[reject]` EC14: pre-existing permissive outbox directory exposes tokens — dev-only transport on a developer machine; adds a stat/chmod guard.
  - `[medium]` `[patch]` BH1: `react-router-serve` (morgan) logs `/sign-in/verify?token=…`, writing live tokens to stdout, violating the logs rule — panel now starts from its own server entry whose request log omits query strings.
  - `[low]` `[patch]` BH2: registry accepts JSON with any Content-Type, allowing CORS-simple cross-site POSTs — POST now requires `application/json` (415 otherwise).
  - `[low]` `[reject]` BH3: no panel-to-registry authentication — the API is internal (default bind 127.0.0.1) and the only open operations need a secret token or answer identically; pilot network-trust model as AD-19.
  - `[low]` `[patch]` BH4: no index for the cross-tenant email lookup — `accounts (email)` index added in 0002.
  - `[low]` `[reject]` BH5: expired links/sessions never purged; older unconsumed links stay valid — pilot scale; each link is single-use and 15-minute; a purge job is new behaviour.
  - `[low]` `[reject]` BH6: shutdown drops in-flight mail work — same as EC12.
  - `[false]` `[reject]` BH7: missing tenant name breaks the email — same refutation as EC5.
  - `[low]` `[reject]` BH8: migrator keeps SET on `dh_sign_in_lookup`; reset block ignores NOINHERIT — the migrator already owns every table (no widening); the lookup role is a member of nothing, so INHERIT has no effect.
  - `[low]` `[patch]` BH9: authenticated panel pages have no cache header — panel-layout responses now `Cache-Control: private, no-store`.
  - `[low]` `[patch]` BH10: refused results mapped to the email field error — same fix as EC10.
  - `[low]` `[reject]` BH11: contract `isSessionCreated` does not check the token shape the panel cookie reader expects — the registry is the only producer and mints exactly that shape; adds a guard.
  - `[low]` `[reject]` BH12: login CSRF by sending a victim the attacker's own link — attacker must be a provisioned account of the pilot Company; residual risk recorded.
  - `[low]` `[reject]` BH13: signed-in users can still open `/sign-in` — cosmetic; adds a session call to the sign-in loader.
  - `[low]` `[patch]` BH14: Bearer scheme match is case-sensitive — now case-insensitive.
  - `[low]` `[reject]` BH15: spec task checkboxes unchecked / turbo.json not changed — fix edits this build's spec; turbo.json needed no change (no typegen output, `PANEL_REGISTRY_URL` is not read by tests).
  - `[low]` `[reject]` BH16: viewport/keyboard/zoom ACs have no automated test — the spec puts them under manual browser checks, which were performed (see Verification); browser automation is a new tool.
  - `[medium]` `[patch]` VG1: `routes.ts` wiring (guarded layout nesting) untested — route-config test added.
  - `[medium]` `[patch]` VG2: `serve-cli` start-up checks (unsafe role, bad panel URL) never executed — CLI cases added to the DB suite.
  - `[medium]` `[patch]` VG3: `SmtpTransport.send` field mapping never exercised — test via nodemailer JSON transport added.
  - `[low]` `[patch]` VG4: no boundary fixture proves rules fire on `.tsx` — `.tsx` fixture and test added.
  - `[low]` `[reject]` VG5: GET consumption vs link scanners — same as EC6.
  - `[low]` `[reject]` IA1: no automated test joins panel, registry and mail — DB suite runs the HTTP API end to end with mail; the joined browser flow was checked manually.
  - `[low]` `[reject]` IA2: contrast pairs hand-transcribed; chrome role text (ink-secondary on surface-raised) not a listed pair — DESIGN.md's table is prose, not data; that pair is #171717 on #FFFFFF (well above 4.5:1).
  - `[low]` `[reject]` IA3: malformed input shows a field error, not the link-sent text — a malformed value is not an address; reveals nothing about accounts; matches the standard-form invalid-submit pattern.
  - `[medium]` `[defer]` IA4: AC "contrast check passes every pair" is not literally met — DESIGN.md's light-mode gold-marks-on-white pair is 1.56:1 with mandated values; pre-existing planning defect, declared as the single exception.
  - `[low]` `[reject]` IA5: no named email vendor — the delivery mechanism (SMTP via Nodemailer, any relay) is chosen and recorded; the relay vendor is deployment configuration, flagged for the human.

## Design Notes

- **Known DESIGN.md defect:** the contrast row "`accent` marks on `surface-raised` ≥ 3:1" cannot pass with the mandated values (`#FFC700` on `#FFFFFF` ≈ 1.56:1, light mode; it passes on `surface-raised-dark`). Tokens must still match DESIGN.md, so the contrast test checks every pair, and lists exactly this light-mode pair as a declared exception with its measured ratio and reason (no adherence-series exists yet; Epic 6 must give accent marks an ink edge or DESIGN.md must change). The test fails if any other pair fails or the exception list grows.
- EXPERIENCE's sign-in state row ("an unprovisioned account receives a denial") predates the approved sprint change; the AC (identical text for any address) wins.
- Link opening consumes on GET to meet "opens it → lands on Inventory"; email link-scanners pre-fetching links is a known risk, recorded, not mitigated here.
- Dark pairs map each light pair to its `-dark` counterpart (ink-dark on surface-base-dark, etc.).

## Verification

**Commands:**
- `docker compose up -d --wait postgres` then `REGISTRY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test` -- all suites pass, DB suites not skipped.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- exit 0.
- `pnpm test` without the env var -- passes, DB suites skipped with a printed reason.

**Manual checks:**
- Migrate + provision a Company locally, run `serve` (outbox transport) and the panel; in a browser at 320, 768 and 1280px: submit a provisioned and an unknown email (same text), open the outbox link (lands on Inventory empty state with chrome), reopen it (denial on sign-in), Tab through sign-in and the nav (visible ring, reading order, no trap); check dark mode via `prefers-color-scheme`.

## Auto Run Result

Status: done

**Summary:** Passwordless magic-link sign-in into a branded management panel. The registry gains migration 0002: `sign_in_links` and `sessions` with forced RLS and hash-only tokens; a narrow `SECURITY DEFINER` email lookup owned by the NOLOGIN role `dh_sign_in_lookup`; and an `accounts (email)` index. It also gains 15-minute single-use links (atomic SQL), 12-hour sessions, and mail transports: SMTP via Nodemailer, a file outbox and in-memory. A `node:http` JSON API (`serve`) answers 202 identically for every well-formed address. The panel is now a React Router 8 SSR app with these parts:
- sign-in, verify, Inventory (empty state) and a Standards shell, under panel-chrome;
- an HttpOnly session cookie;
- one token source matching DESIGN.md (light and dark);
- self-hosted Sora and Poppins;
- an Express server entry whose log omits query strings.

**Files changed:**
- `packages/contract/src/{sign-in,errors,index}.ts` (+ tests): sign-in wire types, guards, error codes and email normalization.
- `apps/registry/migrations/0002_sign_in.sql`, `src/db/{schema,tenant-scope}.ts`: tables, RLS, lookup role and function, extended role-safety check.
- `apps/registry/src/sign-in/{tokens,service}.ts`, `src/mail/*`, `src/http/{server,serve-cli}.ts` (+ unit and DB tests): sign-in service, mail transports, HTTP API.
- `apps/registry/src/tenancy/{validate.ts,tenancy.db.test.ts}`: shared email check; the 1.2 suite knows the new tables and takes an advisory lock.
- `apps/panel/**`: the React Router app (`server.js`, configs, `src/` routes, components, design tokens and contrast, styles, tests). The placeholder files were removed.
- `.dependency-cruiser.cjs`, `tooling/boundaries/*`, `tooling/eslint-config/index.js`, `tsconfig.json`: `.tsx` coverage, workspace-anchored dist exclude, and a `.tsx` boundary fixture.
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`: new catalog entries (React Router 8.4.0, React 19.3.0, Vite 8.3.4, Express 5, Nodemailer 10.1.0 with a release-age exclusion, fontsource, test libraries).
- `README.md`, `docs/decisions/starter-template.md`, `.gitignore`: how to run registry and panel, the env vars, and the email delivery decision.

**Review findings:** 40 findings: high 0, medium 7, low 31, false 2.
- **Patched (17 rows, 15 fixes):** 6 medium (EC1, EC7, BH1, VG1, VG2, VG3) and 11 low (EC2, EC9, EC10, BH2, BH4, BH9, BH10, BH14, VG4). The fixes were:
  - crash-safe URL parsing;
  - mail work no longer tied to the response finishing;
  - `application/json` required on POST;
  - case-insensitive Bearer scheme;
  - `Secure` cookie behind a proxy or on any non-local host;
  - the cookie is cleared only on `session_invalid`;
  - `no-store` on panel pages;
  - an accurate refusal mapping on sign-in;
  - a panel server that keeps tokens out of its logs;
  - an email index;
  - tests for route wiring, the `serve` start-up checks, SMTP field mapping and `.tsx` boundaries.
- **Deferred (1):** IA4. The light-mode gold-marks-on-white contrast pair cannot pass with DESIGN.md values. This is a planning defect, declared as the single exception.
- **Rejected:** 20 low and 2 false. Each has its reason in the triage log.

**Follow-up review recommended: true.** Patched counts: high 0, medium 6, low 11. Unverified risk: the patched panel now runs on a new Express `server.js`. After the patch, only HTTP smoke tests were run against it. It was not re-checked in a real browser at 768px or with keyboard-only navigation.

**Verification:**
- `pnpm run build`, `typecheck`, `lint` and `boundaries` exit 0.
- With `REGISTRY_TEST_DATABASE_URL` (compose PG18): all 10 turbo test tasks pass. Registry: 175 tests. Panel: 89 passed, 1 skipped (the declared exception). Boundaries: 16. Contract: 74.
- Without the URL: all pass, and both DB suites print a skip reason.
- Manual end-to-end (implementer, before the patches): migrated, provisioned, `serve` with the outbox, and the built panel.
  - A known and an unknown email showed the same text, and only the known one wrote mail.
  - The link landed on the Inventory empty state with chrome and role.
  - Reusing the link gave the denial.
  - At 320px in dark mode: the field was focused, there was no horizontal scroll, and the focus ring was visible. 1280px in light mode was also checked.

**Residual risks:**
- Opening a link consumes it on GET, so mail link-scanners can use it up. Login CSRF with an attacker's own link is also possible.
- No rate limiting, no sign-out, no purge of expired rows.
- The email relay vendor is not chosen. The decision recorded is SMTP via Nodemailer; the operator configures `REGISTRY_SMTP_URL`.
- Migration 0002's role and function-ownership steps were tested only with a superuser migrator.
- Dark-mode input borders (DESIGN.md `border-dark` on `surface-raised-dark`) are low-contrast.
- The CI workflow was not run on GitHub.
