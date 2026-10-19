# Deferred work

- source_spec: `_bmad-output/implementation-artifacts/spec-fly-staging-deploy.md`
  summary: Diagnose why `*.internal` private DNS did not resolve from freshly deployed Machines (ENOTFOUND) and switch inter-service URLs back from public to `.internal` when resolved.
  evidence: During staging bring-up, `dh-service-staging` could not resolve `dh-registry-staging.internal` (fetch `transport_failed` every cycle); public `https://dh-registry-staging.fly.dev` works and is used via secrets override. Service still activates bundles correctly through the public URL.
- source_spec: `_bmad-output/implementation-artifacts/spec-fly-staging-deploy.md`
  summary: Refresh vendored Supabase agent skills when upstream drifts (SKILL.md versions lag their CHANGELOGs).
  evidence: Blind review of the fly-staging diff range noticed `supabase-postgres-best-practices` SKILL `1.1.1` vs CHANGELOG `1.6.0` (and `supabase` SKILL `0.1.2` vs `0.1.9`); functional impact is nil, so it stays out of the staging spec — re-run `npx skills add supabase/agent-skills` to refresh.
