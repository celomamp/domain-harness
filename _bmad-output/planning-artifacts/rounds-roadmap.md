# Rounds Roadmap — two-thread (and three-thread) build-auto runs

Created: 2026-10-15 — after the round that closed Stories 4.4 and 5.6 (main at `81c2151`).
Status source: `_bmad-output/implementation-artifacts/sprint-status.yaml` (`last_updated: 15-10-2026 10:25`, validated by `sprint_plan.py status`: **27 done / 18 backlog**, epics: 2 done, 2 in-progress, 4 backlog).
Tracker correction in this revision: Stories 5.1 and 5.2 were historically implemented and merged (`6061af0`, `691fb77`) but tracked as `backlog`; fixed to `done`.

## Definition of MVP (the bar for "something minimal in production")

The core value loop, end to end, with governance evidence:

1. Standard owners record and publish the Company's Standards, scoped to the Buyer's Project tree (Epics 1–2 — done).
2. Builders start Applications already placed inside the Standards (Epic 3 — done).
3. The Builder's agent gets the Company Standard at the moment of decision: the four MCP tools serve (4.4 — done); **events and gaps get recorded (4.5)** and the effective set is readable programmatically (**4.6**).
4. The pipeline stops non-compliant code and the Buyer may accept a Deviation (Epic 5 — done).
5. The Buyer receives auditable evidence without sensitive data leaving the Company (**Epic 6 — the MVP's remaining bulk**).

**MVP = 9 stories outstanding: 4.5, 4.6, and all of Epic 6 (6.1–6.7).**
Epic 7 (analytics) and Epic 8 (offline Gate) are post-MVP — but Epic 8's first story is *de facto* unlocked today (see "Unlocked parallelism"), so it rides along in the spare thread slot of Rounds 1–3 at zero extra rounds.

## Dependency map (what blocks what)

```
4.4 (done) ──> 4.5 (records/gaps) ──> 6.7 (retention & access for Guidance records) ──┐
4.4 (done) ──> 4.6 (Read API)                                                          ├──> Epic 7 (7.1–7.6) — post-MVP
6.1 (catalog) ──> 6.2 (collector chokepoint) ──> 6.3 (durable delivery) ──> 6.4/6.5/6.6 ┘
5.x / 4.1 (done: Gate + bundles) ──> 8.1 (offline load/verify) ──> 8.2 ──> 8.3
```

- Epic 6's critical path is serial: **6.1 → 6.2 → 6.3**. The read surfaces (6.4, 6.5, 6.6) parallelize once 6.3 lands.
- 6.7 does not need Epic 6's delivery chain — it governs the Guidance records that 4.5 creates. It parallelizes with 6.3.
- Epic 7 needs 4.5's data *and* Epic 6's read surfaces; nothing in it unblocks before Round 4's ships.
- Epic 8 needs nothing outstanding: Gate semantics (5.1–5.4) and signed bundles (4.1–4.2) are done. 8.1 is runnable now.

## Unlocked parallelism (answer to "didn't we unlock more?")

| Slot | State |
| --- | --- |
| Two threads, one per open epic (established pattern) | Active: Epic 4's remainder vs Epic 6 (from Round 2 onward) |
| **Third thread (Epic 8 as payload)** | **NEW — unlocked since 4.1/5.x.** 8.1 has no dependency on anything outstanding; it touches a new CLI surface and consumes existing contract types, so it does not collide with the other threads' `contract` exports |
| **6.7 in parallel with 6.3** | NEW from Round 3 (needs only 4.5, which lands in Round 1) |
| **Epic 6's read-tail (6.4 + 6.5 + 6.6, three threads)** | NEW from Round 4 (needs only 6.3) |
| 4.5 + 4.6 in parallel | **Rejected for now** — both live in `apps/service` plus `packages/contract` exports; same-epic same-module collisions in review/merge. They run in successive rounds instead |
| Epic 7 threads | Blocked until Round 4 ships (post-MVP anyway) |

Working rule kept from the round playbook: one worktree per thread, branch per story, no thread touches another's directory or the main host; merges go Epic 4 → Epic 5/Epic 6 → (third epic last) on main, then full integrated verification with both DB URLs before the tracker commit and push.

## Rounds

Each round: two/three planning threads (build-auto planning stops, multi-thread background), then per-story implement → verify (diff read + full verification) → four-layer review → triage → finalize/commit; main sync with frozen-lockfile install + build BEFORE testing, full re-verification, tracker update, single sprint commit, push.

### Round 1 (next) — 3 threads
| Thread | Story | Scope anchor |
| --- | --- | --- |
| A | **4.5** Record Guidance events and gaps in the Company store | `apps/service` (recording layer for the 4.4 serving unit; gap persistence; NFR-9: no subject text in stored fields/logs) |
| B | **6.1** Publish the Compilation catalog, and gate sending on the Buyer reading it | `apps/registry` (+ `packages/contract` module) |
| C (spare) | **8.1** Load and verify a bundle file offline | new CLI surface, consumes existing bundle/verify code — no contract changes expected |

### Round 2 — 2–3 threads
| Thread | Story |
| --- | --- |
| A | **4.6** Read the Effective Standard set through the Read API |
| B | **6.2** Project records into Compilations through one Collector chokepoint (needs 6.1) |
| C (spare) | **8.2** Run the Gate locally with the same result as CI (needs 8.1) |

### Round 3 — 2–3 threads
| Thread | Story |
| --- | --- |
| A | **6.3** Deliver Compilations durably without touching the Builder (needs 6.2) |
| B | **6.7** Buyer controls who reads Guidance records, and how long they are kept (needs 4.5) |
| C (spare) | **8.3** Distribute the CLI (needs 8.2) |

### Round 4 — 3 threads (MVP closes here)
| Thread | Story |
| --- | --- |
| A | **6.4** Buyer sees bundle status, Collector health and drops (needs 6.3) |
| B | **6.5** Buyer sees the inventory by Project and agent tool (needs 6.3) |
| C | **6.6** Buyer reads one Application's evidence and accepts from a Deviation row (needs 6.3) |

### Post-MVP — Epic 7 in 2–3 rounds, 2 threads per round
7.1 (Adherence/frequent Deviations) + 7.2 (Demand and gaps for Standard owners) — both need 4.5 + Round 4 surfaces; then 7.3–7.6 parallelizable in pairs (7.3+7.4, then 7.5+7.6).

## Progress summary

- **27 / 45 done (60%).** MVP: 9 outstanding → **4 rounds as planned** (Epic 8 rides along, closing by Round 3).
- Full scope remaining including post-MVP: 18 stories → ~4 + 3 = 7 rounds.
- Idealist note kept deliberately: if the Buyer judges the Gate + Guidance loop alone production-worthy, Rounds 1–2 alone (4.5 + 4.6) are the bare minimum and every later round adds the evidence surfaces.
