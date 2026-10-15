# Epic 6 Context: The Buyer receives auditable evidence without sensitive data leaving the Company

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives the Buyer auditable evidence about what the business builds and whether Standards are followed, without any sensitive content ever leaving the Company environment. A single Collector projects Company records into a closed, versioned Compilation catalog and sends it outbound; the Buyer audits the schemas first, sees bundle status, Collector health, inventory and per-Application evidence, and controls who may read Guidance records and how long they are kept.

## Stories

- Story 6.1: Publish the Compilation catalog, and gate sending on the Buyer reading it
- Story 6.2: Project records into Compilations through one Collector chokepoint
- Story 6.3: Deliver Compilations durably without touching the Builder
- Story 6.4: Buyer sees bundle status, Collector health and drops
- Story 6.5: Buyer sees the inventory by Project and agent tool
- Story 6.6: Buyer reads one Application's evidence and accepts from a Deviation row
- Story 6.7: Buyer controls who reads Guidance records, and how long they are kept

## Requirements & Constraints

- The pilot Compilation catalog is closed and frozen: Guidance, Gate run, Deviation, Binding refusal, Bundle status (active hash, sequence, staleness), and Collector health (pending, dropped by reason). Every Compilation carries an idempotency key, the Application id, and a per-Application sequence number; a Gate-run Compilation carries checked and open counts so Adherence is derivable.
- The Buyer can read the schema for every Compilation type before the Collector is allowed to send. A Compilation that fails its schema is dropped whole (no partial payload), the drop is visible to the Buyer, and nothing is stored.
- A Compilation contains no prompt text, no Standard content, and no source code. A Guidance subject crosses only as a conflict-slot name token or a Company-keyed hash. Adding a field or type needs a security review and a schema version bump.
- Panel outages never slow or fail Guidance calls or Gate runs; Compilations accumulate in a durable local queue with retries and backoff, resends are idempotent, and queue loss is reported as a Collector-health gap, never silent.
- Stored Guidance holds only the defined fields with a default 90-day retention the Company can change; the Buyer configures which roles can read stored Guidance events, and Guidance-event content is read inside the Company environment, never on the panel.
- Inventory groups Applications by Project and agent tool, includes Applications with no Compilation yet, and never shows a Builder name. Tenant isolation holds for Compilations as for all Company data.

## Technical Decisions

- Compilation schemas, the catalog version, tool result types, and the error envelope live versioned in `packages/contract`. Every Compilation type carries an explicit semver and a type name; a consumer rejects an unknown major and reports its own version.
- A single Collector module owns the only record-to-Compilation function, validates against the published schema, and is the only code with an outbound path to the vendor panel. No adapter has a network path to the vendor.
- The Company service authenticates to the registry with a per-tenant credential for bundle pull and Compilation push; roles live in the registry and Guidance-record reads use short-lived, tenant-scoped role tokens reflecting the Buyer's grant.
- Per-Application sequencing assigned by the Company record store is the single ordering; revision-after-event questions are evaluated by that sequence, never by commit ancestry or host clocks. A UUIDv7 idempotency key makes resends safe.
- The Company service is reachable only inside the Company network; the panel configures grants and shows Compilation-derived evidence only, never proxies, caches, or renders Guidance content.

## UX & Interaction Patterns

- The Compilations surface shows a schema-reader (raised surface, body text, schema in ink on white) listing the versioned schema for every Compilation type; the empty state still shows the schema-reader, and the Buyer must have read the schema before the Collector may send.
- Bundle status shows per service the active hash, sequence, age against the bound, freeze state, and the word "stale" when past the bound; pending and dropped counts show by reason, and a dropped Compilation is announced as status text stating the schema failed and no partial payload was stored.
- Inventory rows group under an agent-tool heading in a table with header cells; when Compilations cannot load, the structure stays and the evidence region says the Compilation did not arrive.
- The Application surface shows the latest Adherence as text, deviation rows with open/accepted status words and a copyable cream-inset Correction instruction, and whether any Guidance event exists; accepting from an open row opens the Epic 5 acceptance form pre-filled, and Esc returns focus to the row.

## Cross-Story Dependencies

- Story 6.1 must publish the catalog, the read-gate, and the ingestion endpoint before 6.2/6.3 can project or deliver anything through it.
- Story 6.2 must deliver the projection chokepoint (slot-token-or-hash subjects, whole-payload drops) before 6.3 sends real Compilations.
- Story 6.3 must deliver durable delivery and idempotent ingest before 6.4/6.5/6.6 can trust what they display.
- Story 6.1's read-record and 6.4's status views share the Compilations panel surface; 6.6 reuses the Epic 5 acceptance form and match key; 6.7 reuses the registry role/grant and token machinery.
