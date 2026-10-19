---
title: 'Fly staging deploy for domain-harness'
type: 'feature'
created: '10-19-2026'
status: 'done'
route: 'dispatch'
baseline_commit: '91f2dc72008e08fe6ccb265a56bc0ddcea850fad'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staging is proven only against Supabase from this laptop; nothing runs continuously, publicly, or outside a developer machine, so there is no homologation environment to test against.

**Approach:** Deploy the four processes to Fly.io (registry API, panel, service daemon, guidance server) wired to the Supabase staging project, with Dockerfiles where missing, one `fly.toml` per app, secrets via `fly secrets`, and a staging runbook. No code changes to app behavior.

## Boundaries & Constraints

**Always:**
- Reuse the Supabase staging project (`wjwhmjlassmesbxpwdhi`, us-east-1); no new databases except through the documented `record_store` second DB.
- All runtime secrets via `fly secrets set`; `fly.toml [env]` carries only non-secret values. No secret is ever committed; `.env`-style files stay local and gitignored.
- Internal traffic over Fly private networking (`*.internal`); only panel (and registry API if builders need it) gets a public address.
- Every app `auto_stop_machines = false`, `min_machines_running = 1` — the daemon's pull loop and the servers must stay on.
- TCP healthchecks only (no `/healthz` exists): `tcp_checks` on 4100/3000/8080; daemon has no checks.

**Never:**
- No app-code changes (Dockerfiles, fly.tomls, docs only). No migration edits in this spec.
- No SMTP credentials in the repo or in chat logs beyond what the owner pastes for `fly secrets set`.
- No production data, no custom domains, no auto-scaling setup in this round.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deploy | `fly deploy` per app with secrets set | 4 apps healthy, panel reachable, registry listening | Failed healthcheck blocks release; previous Machines stay |
| Cold boot order | DBs migrated, company provisioned | Registry → panel → service → guidance start clean | Missing secret fails fast with the app's one-sentence envelope |
| Sign-in | SMTP configured | Magic link delivered, session works | Without SMTP, links never deliver (documented gap, not silent) |
| Daemon | Vendor URL = internal registry | Pull → verify → activate cycles in logs | Unreachable vendor logged per cycle, never crashes |
| Rollback | Bad deploy | `fly deploy` of previous image restores | Documented command in runbook |

## Decisions

- ORG: `personal`.
- SMTP: Mailtrap sandbox (`sandbox.smtp.mailtrap.io`, STARTTLS, user `551331ce042330`) — credentials go straight to `fly secrets`, never committed. Sandbox catches mail (no real delivery); staging sign-in links are read from the Mailtrap inbox.
- REGION: all four apps in `iad` (next to Supabase us-east-1).
- PUBLIC URLS: default `*.fly.dev` subdomains; internal traffic via `*.internal`.

</frozen-after-approval>

## Code Map

- `apps/service/Dockerfile:4-32` -- template (node:26-bookworm-slim, corepack 0.36.0, frozen-lockfile install, source-mode CMD, no ports).
- `apps/registry/package.json:8,14`, `apps/registry/tsconfig.build.json:3-6` -- `tsc -b` build to `dist/`; runtime `node --conditions=@domain-harness/source src/http/serve-cli.ts`; needs HOST=0.0.0.0.
- `apps/panel/package.json:9-10`, `apps/panel/server.js:41-43`, `apps/panel/src/registry.server.ts:107-117` -- `react-router build` then `node server.js`; PORT/HOST env; PANEL_REGISTRY_URL points at registry.
- `apps/service/src/bundles/service-cli.ts:1-15,48-53,148-150` -- daemon, outbound-only, auto-migrates, SIGINT/SIGTERM handled.
- `apps/service/src/guidance/server-cli.ts:304-340` -- guidance server, port 8080 default, auto-migrates.
- `apps/registry/src/http/serve-cli.ts:47-104` -- required env + fail-closed envelopes the runbook mirrors.
- `tooling/local/defaults.sh:11-35` -- local defaults that staging values replace.

## Tasks & Acceptance

**Execution:**
- [x] `apps/registry/Dockerfile` -- image for `registry serve` (node:26, frozen install, source-mode CMD like service), exposes 4100.
- [x] `apps/panel/Dockerfile` -- multi-stage (build `react-router build`, slim runtime with `server.js` + `dist/`), exposes 3000.
- [x] `apps/service/Dockerfile.guidance` -- guidance-server image (same source-mode pattern, wider workspace manifests, CMD `src/guidance/server-cli.ts`), exposes 8080. The daemon keeps using `apps/service/Dockerfile` unchanged.
- [x] `fly.registry-staging.toml`, `fly.panel-staging.toml`, `fly.service-staging.toml`, `fly.guidance-staging.toml` -- app names, region, `[env]`, services/ports, TCP checks, `auto_stop_machines=false`.
- [x] `docs/staging.md` -- runbook: secret list per app (names only), boot order, deploy/rollback commands, sign-in expectation, fresh key generation (`local:keys` pattern outside the repo).
- [x] Staging secrets inventory -- names + source for each (Supabase dashboard, provision output, generated) without values (section in `docs/staging.md`).
- [x] `.dockerignore` -- additive only: `.outbox`, `.env`, `.env.*`, `supabase/.temp` (local-only files must never reach remote builders).

**Acceptance Criteria:**
- Given the four fly.tomls, when `fly config validate` (or `fly deploy --build-only --remote-only`) runs, then all pass without local Docker.
- Given secrets set, when apps deploy, then healthchecks pass and the panel serves the sign-in page.
- Given a published standard, when the daemon runs, then bundle cycles show pull → verify → activate in logs.
- Given `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries`, when they run, then all pass (Dockerfiles add no workspace code).

## Implementation Notes

Review patches applied 2026-10-19 (all verified offline unless noted):
- P1 runbook: provision via runtime role URL (owner URL is refused by `assertRuntimeRoleSafe` — verified in code) + pooler fallback note; `CREATE DATABASE record_store;` SQL + direct-vs-pooler connection shapes; auto-migrate serialization note; release_command failure recovery.
- P2 `tooling/staging/` package (15 tests green, lint/typecheck clean): exact-value toml wiring pins, Dockerfile COPY/CMD existence checks, panel no-workspace-import regression test. Two test bugs fixed during verification (service has no `[[services]]` block; `--from=` builder paths are not repo paths; dist comment mentions are not imports).
- P3 CI `docker-build` job (4 image builds, ruby-YAML parsed here; runs in CI — no local Docker).
- P4 `.gitignore`: `*.pem`, `*.key`, `company.json`.
- Deferred: B13 vendored skill metadata → deferred-work.md.
- Matrix audit: deploy/boot/sign-in/daemon/rollback rows are documented, not executed here (no remote ops per workflow, no local Docker, SMTP pending) — live proof is the human/follow-up deploy step.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass (blind-hunter 13, edge-case-hunter 0, verification-gap 2)

- `[false]` B1 panel runtime missing contract dist — verified: `dist/server/index.js` has no `@domain-harness/*` runtime imports and `server.js` imports only express/react-router/node; workspace code is bundled. Pinned as a regression test instead.
- `[low]` `[reject]` B2 devDeps in registry/guidance images, no USER/pruning — matches the proven service-Dockerfile pattern; staging image size is negligible harm; multi-stage refactor exceeds direct correction.
- `[low]` `[patch]` B3 no ignore rules for `*.pem`/`company.json` — verified: `.env`/`.outbox` covered, these are not; `git add -A` would sweep a real `company.json`. Fix: ignore rules (direct correction).
- `[low]` `[patch]` B4 runbook lacks record_store SQL, connection shapes, migrate-failure recovery — verified partially: auto-migrate race is answered by design (shared advisory lock serializes); the SQL/shape/recovery docs are missing. Fix: doc lines.
- `[low]` `[reject]` B5 key derivation/rotation gaps — derivation is referenced (`local-keys.sh`), id-swap rotation documented; deeper rotation ceremony is out of staging scope.
- `[false]` B6 company.json/credential storage gaps — covered: shape in README, storage in secret manager, both referenced.
- `[low]` `[patch]` B7 rollback omits DB/release_command recovery — verified: append-only design needs no DB rollback, but failed-release recovery deserves three lines. Fix: doc lines.
- `[low]` `[reject]` B8 guidance public ports vs no-public-IP — real tension but exposure needs deliberate `fly ips allocate` against the documented guard; redesign (flycast) is unverifiable here.
- `[false]` B9 daemon has no restart policy — platform default restarts crashed Machines; `scale count 1` documented; deploy smoke will confirm.
- `[false]` B10 grace_period 30s unjustified — release_command migrates before boot, so grace covers app boot only (seconds); generous, not wrong.
- `[low]` `[reject]` B11 identical VM sizes, no cost/notes — shared-cpu-1x is the obvious staging default; metrics/autoscaling explicitly out of scope.
- `[false]` B12 Mailtrap username/sender in repo — identifiers in repo + secrets in secrets manager is the correct split.
- `[defer]` B13 vendored skill metadata stale — pre-existing (installed before this spec), not caused by this change; cosmetic. Recorded in deferred-work.md.
- `[none]` edge-case layer returned no findings.
- `[medium]` `[patch]` V1 image contents untested (pre-verified) — filed evidence trusted. Fix: static image-contents test (offline; catches the demo's typo/missing-manifest cases) + CI docker-build job (runs in CI; YAML parsed here).
- `[medium]` `[patch]` V2 toml wiring untested (pre-verified) — filed evidence trusted. Fix: static toml-consistency test pinning exact cross-file values.

Grouped entries: P1 runbook fixes [B4+B7]; P2 static staging checks [V1-static+V2]; P3 CI docker-build job [V1-ci]; P4 gitignore rules [B3]. No intent_gap or bad_spec — no loopback.

## Verification

**Commands:**
- `fly config validate -c <each fly.toml>` -- expected: valid configs.
- `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run boundaries` -- expected: clean (no app code touched).
- Live deploy + sign-in + daemon cycle -- expected: only after ORG/SMTP/REGION answers; executed by human or a follow-up run.

**Implementation result (2026-10-19, subagent):**
- `fly config validate` passes for all four tomls (guidance needed a
  schema-required `[[services.ports]]` entry; it stays unreachable — no
  public IP is ever allocated, verified via `fly ips list` per runbook).
- `pnpm run build`, `typecheck`, `lint`, `boundaries` all pass
  (17+17 turbo tasks, no violations).
- Remote `--build-only` deploy could not run: the four Fly apps do not exist
  yet and no local Docker is available; creating apps / first deploy is the
  documented human follow-up. Dockerfile risk was reduced instead by
  verifying the built panel bundle has no workspace runtime imports
  (fully bundled; only prod node_modules externals, all covered by the
  runtime stage's `pnpm install --prod`) and by mirroring the proven
  `apps/service/Dockerfile` install pattern with exact manifest sets.
