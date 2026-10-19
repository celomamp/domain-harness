---
title: 'Local env stabilization with few documented commands'
type: 'chore'
created: '10-18-2026'
status: 'done'
route: 'dispatch'
baseline_commit: '2fe6e756b92492f571712ffd296a1177f3f8c1fa'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Running the stack locally today needs ~18 manual commands across README sections, long hand-built exports, and two terminals, so a clean clone does not boot and test without friction.

**Approach:** Give the local environment working defaults and a short documented path: one env sample, a few `pnpm local:*` commands covering boot, migrate, provision, serve, and test, with the README reduced to that short path.

## Boundaries & Constraints

**Always:**
- Local-only credentials stay local-only and documented as such; no real secret is ever committed.
- Keep the CI contract unchanged (`pnpm run build`, `typecheck`, `lint`, `boundaries`, `pnpm test` keep passing on Node 24 and 26).
- Boundaries stay clean: no new cross-app imports; helper scripts live at root or `tooling/`, never inside app runtimes.
- Every documented command must work from a clean clone after `pnpm install` plus Docker.

**Never:**
- No production config, deploy, secret-manager, or pricing/plan changes.
- No migrations, schema changes, or runtime behavior changes in registry, service, panel, or CLI.
- No network calls added to tests; no silent DB requirement introduced where a skip is the house rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean boot | Docker available, no `.env`, empty DB volume | `pnpm local:up` brings postgres, runs migrate, prints next step | Clear message when Docker is down, exit 1 |
| Tests without DB | No `*_TEST_DATABASE_URL` set, no `CI` | `pnpm test` passes with printed skip reasons | With `CI=1` and no URL, fail as today |
| Tests with DB | Postgres up on 5432 | `pnpm local:test` exports both test URLs and runs full suite green | Failing suite keeps exit code and names the package |
| Serve pair | Registry migrated + provisioned | Registry serve on 4100 and panel reachable with outbox mail | Missing outbox/SMTP choice fails with one sentence before listen |
| Service local | No tenant credential or trust keys | Service daemon refuses with current envelope, docs show where to paste values | Never start with placeholder keys |

## Decisions

- ENV SHAPE: `.env.local.example` + `pnpm local:*` loading defaults.
- SCOPE: full stack including service compose, guidance server-cli, and CLI verify/gate smoke.
- TEST DEFAULT: `pnpm local:test` boots postgres and always runs DB suites; plain `pnpm test` keeps existing skip behavior.
- PANEL MODE: local standardized on `panel dev` :5173 with `REGISTRY_PANEL_URL` matching.

</frozen-after-approval>

## Code Map

- `README.md:34-139` -- command surface to shrink; DB, migrate, provision, serve sections to replace with short path.
- `package.json:9-15` -- add `local:*` scripts; keep `build/typecheck/lint/boundaries/test` untouched.
- `compose.yaml:9-16` -- registry postgres :5432 healthcheck; reuse for `local:up`.
- `apps/service/compose.yaml:16-48` -- record-store :5433 plus placeholder credential/trust vars; fix or document.
- `apps/service/src/bundles/env.ts:54-151`, `apps/service/src/guidance/config.ts:21-104` -- env names and fail-closed rules to mirror in sample.
- `apps/registry/src/tenancy/tenancy.db.test.ts:34-40` -- skip-unless-URL plus `CI` fail rule to preserve.
- `.github/workflows/ci.yml` -- CI steps to keep green; do not change.
- `apps/cli/README.md`, `apps/panel/server.js:41-42`, `apps/panel/src/registry.server.ts:116` -- ports and defaults to pin in docs.

## Tasks & Acceptance

**Execution:**
- [x] `.env.local.example` -- one sample with every local var and local-only values, matching README var names -- removes scattered copy-paste.
- [x] `package.json` -- `local:up`, `local:migrate`, `local:test`, `local:serve:*` scripts wiring compose + migrate + both test URLs -- three or fewer README commands.
- [x] `README.md` -- replace long export sections with the short path plus a troubleshooting block (Docker down, port busy, missing credential) -- clean-clone boot without reading other docs.
- [x] `apps/service/compose.yaml` -- working local defaults or explicit placeholder refusal -- service stack boots or fails with one sentence.
- [x] I/O matrix edge-case tests for helper scripts (missing Docker, missing URL, CI without URL) -- pins fail-closed behavior.

**Acceptance Criteria:**
- Given a clean clone with Docker running, when the documented short path runs, then registry migrate, provision, serve, panel, and the default test command all work without extra exports.
- Given no test DB URLs and no `CI`, when `pnpm test` runs, then it passes with the existing skip messages.
- Given `CI=1` without DB URLs, when tests run, then they fail as today.
- Given `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` run, then all pass with no violations.

## Implementation Notes

- Implemented 10-19-2026 in working tree (uncommitted): `.env.local.example` NEW, `tooling/local/` NEW (defaults.sh, env.ts, 8 `local-*.sh`, local-env.test.ts 24 tests, package.json, tsconfig, eslint config), `package.json` +9 `local:*` scripts, README short path + troubleshooting, service compose `:?` fail-fast, CLI README smoke section, `.gitignore` un-ignores `.env.local.example`.
- Fixed during implementation: dev-key path inconsistency (example+test said `.local/`, scripts+README use `$HOME/.domain-harness`) — aligned example and test to `$HOME` (outside repo, never committed).
- Verified here: build 10/10, typecheck 17/17, lint 17/17, boundaries clean, local-env 24/24, CLI smoke ok, full `pnpm test` 17/17 with DB suites skipped (no URLs, no CI), Docker-down refusal exit 1 one sentence for `local:up` and `local:test`.
- NOT executable in this environment (Docker down): live `local:up` boot, `local:test` full DB suite, serve pair, service stack. Live-boot AC and matrix rows Clean-boot / Tests-with-DB / Serve-pair rest on unit pins + script review only.
- Review patches (2026-10-19, all offline-verified): (1) added `local-serve-guidance.sh` + `local:guidance` closing the frozen scope gap; (2) dev-key input contract — `printf '%b'` unescape honoring the documented `\n` behavior + commented-out empty key in the example so sourcing it no longer blocks autogeneration; (3) arg-count guards in `local-up.sh`/`local-provision.sh`; (4) 9 new execution tests (stub docker/HOME/pnpm, sourcing probes) covering Docker refusal, defaults `=` semantics, serve-registry unset-vs-empty, and PEM unescape. Lint clean, 33/33 green.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass (three layers: blind-hunter 12, edge-case-hunter 15, verification-gap 3)

- `[false]` B1 defaults/exports/sample cover different var sets — verified: secrets intentionally defaultless; defaults.sh mirrors the example; README documents `cp` + user load. No bad outcome.
- `[false]` B2 serve-registry unset-vs-empty unreliable / $(cat) strips newlines — verified: bare `export NAME` does not set the var so the `+x` test holds; PEM parses without trailing newline.
- `[false]` B3 serve readiness resolves on any HTTP status — verified: 401 proves listening, which is the probe's only job; host/port are local defaults; 30s generous; trap kills registry on exit.
- `[false]` B4 local-test never migrates first — verified: db suites self-migrate throwaway DBs (`apps/registry/src/tenancy/tenancy.db.test.ts:19,95`).
- `[low]` `[reject]` B5 up/provision single URL, no file check, credential next-step — verified fail-closed via registry envelope; usage guard exists; everyday use unaffected.
- `[low]` `[reject]` B6 trust-set instructions differ / quoting variance — verified: keys.sh output is shell-pasteable, dotenv strips quotes, bad values fail closed.
- `[false]` B7 credential-refusal early-return / placeholder variants — verified: sequential fixing is normal UX; empties defer to daemon envelope by design.
- `[false]` B8 isCi diverges from suites — verified byte-identical to `tenancy.db.test.ts:28`.
- `[false]` B9 test title says `.local` — fixed during implementation; title and example now read `$HOME/.domain-harness`.
- `[false]` B10 turbo skips tooling/local — refuted: local-env ran in typecheck/lint/test 17/17.
- `[false]` B11 smoke nits (hidden output, hardcoded tenant, rebuild) — verified: tenant irrelevant (refusal precedes it; observed `bundle verification failed`); surprise paths print own message.
- `[low]` `[reject]` B12 README missing extra recoveries — spec named 3 troubleshooting cases and all exist; extras exceed direct correction.
- `[false]` E1 isCi CI=0/whitespace/case — same refutation as B8.
- `[false]` E2 SMTP without MAIL_FROM passes helper — verified: registry refuses `missing_configuration` (`from-env.ts:33-39`); helper scope is the choice; fail-closed preserved.
- `[false]` E3 both placeholders, only first reported — same refutation as B7.
- `[false]` E4 role-token placeholder never rejected — verified: no documented placeholder for that var; compose does not consume it; daemon fail-closes.
- `[false]` E5 TENANT_CREDENTIAL never exported — verified: no default by design; user-exported/inline env inherits; compose `:?` fails fast otherwise.
- `[false]` E6 HOME unset crashes — verified: `set -eu` exits non-zero naming HOME (fail-closed); HOME always set in practice.
- `[false]` E7 whitespace-only key passes non-empty — verified: passes through to registry refusal; never starts.
- `[medium]` `[patch]` E8 pasted PEM literal `\n` never unescaped — verified: example line 39 promises `\n` handling but serve-registry.sh does none; pasted key fails confusingly. Fix: `printf '%b'` unescape (safe: real PEMs contain no backslashes).
- `[false]` E9 error status counts as ready — same refutation as B3.
- `[low]` `[reject]` E10 fixed 30s timeout — registry boots in seconds; override adds surface for an unlikely case.
- `[low]` `[reject]` E11 does-not-exist.json collision — contrived; fix exceeds direct correction.
- `[low]` `[patch]` E12 extra args silently ignored — verified: `local-up.sh`/`local-provision.sh` accept extras silently. Fix: arg-count guards (direct correction, offline-testable).
- `[low]` `[reject]` E13 corrupt key file stack trace — requires disk corruption; fix adds branches beyond direct correction.
- `[medium]` `[patch]` E14 dotenv sample sets empty signing key — verified real: uncommented-empty `REGISTRY_BUNDLE_SIGNING_KEY=` in the example becomes set-but-empty on source, skipping autogeneration and failing the documented dotenv path. Fix: comment it out.
- `[medium]` `[patch]` E15 scope promises guidance, no local script — verified: no guidance in tooling/local or package.json; frozen Decisions require it. Fix: `local-serve-guidance.sh` + `local:guidance` + README line.
- `[medium]` `[patch]` V1 Docker guard only substring-pinned (pre-verified) — filed evidence trusted. Fix: offline spawn tests with stub docker.
- `[medium]` `[patch]` V2 serve-registry unset-vs-empty not executed (pre-verified) — filed evidence trusted. Fix: execution test with stub pnpm + stub HOME (also covers E8 unescape).
- `[medium]` `[patch]` V3 defaults `=` vs `:=` not executed (pre-verified) — filed evidence trusted. Fix: sourcing test (empty-preserved vs default-applied).

Grouped entries: (1) guidance wrapper [E15]; (2) dev-key input contract [E8+E14]; (3) unexecuted shell guards [V1+V2+V3]; (4) arg-count guards [E12]. No intent_gap or bad_spec — no loopback.

## Verification

**Commands:**
- `pnpm run build` -- expected: workspace builds.
- `pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: clean, no violations.
- `pnpm test` -- expected: passes with documented skips when DB URLs are absent.
- `pnpm local:test` -- expected: full suite green with postgres up (per Open Questions decision).
