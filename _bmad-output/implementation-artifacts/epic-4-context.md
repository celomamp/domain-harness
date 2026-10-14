# Epic 4 Context: A Builder's agent gets the Company Standard at the moment of decision

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver the trusted bridge between the registry's published Standards and a Company's running work. Registry mutations produce signed, immutable, hash-addressed Standard bundles, and the Company-operated service pulls them over an outbound-only HTTPS link, verifies and activates one atomically, then serves Document response to agents over MCP (the four granular tools) with the bundle hash pinned on every call. Application identity is resolved from the bundle by Application id, with trust-on-first-use binding against a repository fingerprint, and mismatches refused. Guidance records and gaps are stored against the Application, and the same service exposes a read-only Read API. Everything the company agent sees stays consistent with one bundle version.

## Stories

- Story 4.1: Registry compiles and signs Standard bundles
- Story 4.2: Company service pulls, verifies and activates bundles
- Story 4.3: Identify the Application on every Guidance call
- Story 4.4: Serve Document response through the four MCP tools
- Story 4.5: Record Guidance events and gaps in the Company store
- Story 4.6: Read the Effective Standard set through the Read API

## Requirements & Constraints

- **Bundle contents:** immutable Standard bundle carries Standards at their current versions, the Project tree, Locked rules, Applications (id → Project, created-by-flow flag), Accepted deviations, the staleness bound and the freeze state. A mutation is validated as a whole bundle before it is accepted.
- **Bundle signing:** signature covers the tenant id, a per-tenant monotonic sequence and the key id. Bundle hash is the identity quoted in every Guidance response, Gate run and Compilation. Signing keys come from the environment or secret manager; a key file in the repository fails the build.
- **Pull/verify/activate:** the Company makes only outbound HTTPS calls with a per-tenant credential. The service stores the active-bundle pointer in its record store (not process memory), swapped in one transaction after verification. A bundle is refused (with a recorded reason) on signature failure, unknown key id, tenant mismatch, hash mismatch, or sequence lower than the active one. Two replicas report the same active hash.
- **Staleness:** the service records bundle age. Past the Buyer-set bound (default 24h), CI Gate returns an explicit `stale` result with non-zero exit, while Guidance keeps serving the active bundle and flags every response stale. A recorded freeze suspends the bound. Service-side age propagates to the CLI via the bundle's issue time in later epics.
- **Tenant safety:** tenant id is present on every data-layer path; row-level security is a second guard. A tenant's credential receives only that tenant's latest bundle.
- **Guidance tools:** exactly `code_stack_rule`, `design_component`, `design_token`, `design_import`; tool names and inputs are versioned in `packages/contract`. Descriptions state the decision and inputs.
- **Typed results:** every tool returns exactly one of `hit` (Standard id, version, content including the Correction instruction), `miss` (the asked-for subject, one sentence) or `unbound`. A miss is persisted by the service, not the agent, as a gap.
- **Binding:** the Application id comes from the identification file; fingerprint is SHA-256 of the root commit SHA (`git rev-list --max-parents=0 HEAD`), computed at call time by the stdio bridge. First use binds id → fingerprint (trust on first use). A bound id with a different fingerprint is refused and recorded. A missing or unreadable file, or an id absent from the bundle, yields `unbound` with one sentence and returns no other Project's Standards. An advisory Project id that disagrees with the bundle is reported but never used.
- **Performance:** p95 under 500 ms from the bundle cache; Guidance never blocks the agent's turn and needs no prior briefing call.
- **Privacy:** Guidance-event records hold only Application id, tool, subject asked, Standard id/version or miss, agent tool name, bundle hash, UTC timestamp and a per-Application sequence. No raw prompt text. Logs and metrics carry ids and counts, never subject text.
- **Read API:** a credentialed Company system reads published Standards and the Effective Standard set for a Project (equals what Guidance would resolve, quoting the bundle hash). Missing/invalid credentials use the error envelope. No write method exists on any Read API path.
- **Neutrality:** the service is reachable only inside the Company network with no inbound port, and Guidance works only through MCP and instruction files (no vendor hook).
- **Deployment:** the service ships as one container image with its own Postgres (compose or Helm); environment configures vendor URL, tenant credential and trust set.

## Technical Decisions

- Hexagonal core: Effective-set resolution and Deviation evaluation exist only in `packages/core`. Adapters and the registry import `core` and `contract`; `extractor` imports `contract` only. Bundle format, tool result types and error envelope are defined in `packages/contract` with semver plus type name.
- All data access is tenant-scoped; the application database role must not own the tables, with row-level security as a second guard. Ids are opaque UUIDv7; timestamps UTC ISO-8601; errors use `{ code, message, subject }`.
- MCP adapter runs over Streamable HTTP using the MCP SDK behind it; tool descriptors and header names are versioned in `contract`. The Company service, Guidance MCP adapter, Read API, bundle puller/cache, binding table and record store live in one Company-operated service (one container plus Postgres).
- The registry (not the service) authenticates per-tenant, issues short-lived tenant-scoped role tokens for Guidance-event reads, and evaluates FR-15 alerts. The service enforces bundle + binding rules only.
- Guidance records live in the Company store with default 90-day retention (Company-configurable). Role-gated Guidance reads happen through the Company service inside the network; the panel neither proxies nor caches content.
- Accepted deviations, tree and Standards reach the service only inside bundles (never by foreign model adaptation).

## UX & Interaction Patterns

- Host text contract (UX-DR29): every outcome prints one fixed sentence — pass, fail, unbound Application, missing/unreadable identification file, duplicate Application id, run did not complete, Effective Standard set could not be read, stale, bundle failed verification. Miss sentences include the asked-for subject. Stale responses say they are stale. Host output never names a plan.
- Tool descriptions (UX-DR30) are product copy stating the decision and inputs and are reviewed as copy.
- Bundle status surfaces (UX-DR21) show, per service, active bundle hash, sequence, age against bound, freeze state and a stale marker; the stored Guidance gap list names Application, tool and subject without prompt text.
- Responses are typed and quoted to the pinned bundle hash so the agent and its agent-facing store agree on one version.

## Cross-Story Dependencies

- From Epic 1/2: Standards, Modules, owners, Project tree, Locked rules and conflict slots are authored in the registry and compiled into bundles; bundle mutation validation reuses core (AD-13).
- From Epic 3: Applications (id → Project) are bundle inputs. Boilerplates' MCP configuration already declares `@domain-harness/mcp-bridge` pointing at the tenant Guidance endpoint, so no regeneration is needed once the service is live.
- Within this epic: bundle + signer (4.1) feed pull/verify/activate (4.2); binding before/with tool serving (4.3, 4.4); miss recording (4.5) rides on tool calls; Read API (4.6) reuses pinned Active bundle and same resolution.
- Later epics: Epic 5 consumes pinned bundles, binding and unbound rules for the CI Gate; Epic 6 projects guidance/gap records into Compilations; Epic 8 (optional) reuses bundle verification and local binding offline.
