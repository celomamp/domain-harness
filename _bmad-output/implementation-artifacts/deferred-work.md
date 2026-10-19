# Deferred work

- source_spec: `_bmad-output/implementation-artifacts/spec-fly-staging-deploy.md`
  summary: Refresh vendored Supabase agent skills when upstream drifts (SKILL.md versions lag their CHANGELOGs).
  evidence: Blind review of the fly-staging diff range noticed `supabase-postgres-best-practices` SKILL `1.1.1` vs CHANGELOG `1.6.0` (and `supabase` SKILL `0.1.2` vs `0.1.9`); functional impact is nil, so it stays out of the staging spec — re-run `npx skills add supabase/agent-skills` to refresh.
