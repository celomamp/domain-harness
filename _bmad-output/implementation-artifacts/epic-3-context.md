# Epic 3 Context: A Builder starts an Application already placed inside the Standards

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a Builder start a new Application that already sits inside the Company's Standards. On the management panel the Builder describes the Application and picks a Project. The registry creates the Application, mints its id, and generates a Boilerplate repository archive for Claude Code or Cursor. The archive holds the Project identification file, compliant dependency pins and design-system references, an MCP configuration that points at the Company Guidance endpoint, and generated skills/instruction files, so the agent can request Guidance without any manual MCP setup. The Buyer sees the Application immediately. The Buyer can also register existing Applications, which form the baseline set that later cross-checks compare against. The Application id becomes the join key for Guidance, the Gate and Collectors in every later epic. The pilot's headline metric (Adherence lift of flow-created Applications over the baseline set) depends on this epic.

## Stories

- Story 3.1: Builder places a new Application on a Project
- Story 3.2: Define the Project identification file
- Story 3.3: Generate a Boilerplate for Claude Code
- Story 3.4: Generate a Boilerplate for Cursor
- Story 3.5: Buyer registers an existing Application

## Requirements & Constraints

- **Placement:** an Application is bound to exactly one Project. A description with no Project creates nothing, and the text names the Project field and tells the Builder to choose a Project. Placing an Application requires a per-Project build grant. Only the Buyer grants it, and the grant is stored append-only. It is separate from the Epic 2 child-creation permission. Without the grant, the Builder gets a denial and nothing is created.
- **Immediate visibility:** the Buyer sees a new Application in the Inventory Applications list right away, before any Guidance event or Gate run. Compilation evidence fills in later (Epic 6). The list never shows a Builder name.
- **Flow flag:** each Application records whether the New-application flow created it. Applications registered by the Buyer are flagged not-from-flow and form the baseline set. Registration is Buyer-only. It returns only the identification file to commit, with no Boilerplate. A Builder or Standard owner who tries to register gets a denial.
- **Identification file:** a hidden dotfile at the repository root. It carries a semver, the registry-minted Application id and an advisory Project id. The parser returns parsed values or an explicit "missing" or "unreadable" result, never a default. An unknown major version is "unreadable" and uses the error envelope. The Project is always resolved from the bundle by Application id. The file's Project id is advisory, so a mismatch is reported and never used. Downstream, a missing or unreadable file or an unknown id means `unbound`, never a silent pass.
- **Boilerplate contents:** the identification file; dependency pins that satisfy every required and approved code-stack entry and include no prohibited one; design-system references (required imports and tokens); an MCP configuration that declares the stdio bridge `@domain-harness/mcp-bridge` (run via `npx`, with the endpoint URL as its argument) as the Domain Harness server; and skills/instruction files the target tool loads natively. These files tell the agent to make an initial commit before it calls Guidance. The archive contains no hook configuration of any kind (neutrality).
- **Ecosystem limit:** the pilot supports only TypeScript/npm. If the Effective Standard set requires an unsupported ecosystem, generation stops with one sentence that names the unsupported required entries, and no partial archive is produced.
- **Guidance endpoint:** the Buyer sets the Company Guidance endpoint URL once per tenant on the New-application flow surface. It must be an HTTPS URL, and changes are recorded append-only. When it is unset, generation is refused with text telling the Builder to ask the Buyer to set it. The Company service behind that URL arrives in Epic 4.
- **Targets:** Claude Code and Cursor. The chosen tool is recorded on the Application as its agent tool. For the same Application and bundle input, the identification file and dependency pins are byte-identical across both targets. Only the MCP configuration and the instruction-file locations and formats differ.
- **Band:** the New-application flow is never blocked by Active governed Application band overage.

## Technical Decisions

- **Registry owns generation:** Boilerplate generation, Application id minting and identification-file content all live in `apps/registry`. The registry is the only place that mints the id. It resolves the Effective Standard set through `packages/core` on registry data. Generation is not an adapter on the core, and no adapter or the core grows project-generation logic. Delivery is a repository archive.
- **Contract:** `packages/contract` defines the identification file name, format, semver and parser. The header names (`X-DH-Application-Id`, `X-DH-Repo-Fingerprint`) and the fingerprint algorithm are also versioned there for Epic 4. Consumers reject an unknown major version.
- **Call-time identity (context for the bridge entry):** the fingerprint cannot be baked into the archive because no root commit exists at generation time. The stdio bridge computes the identity values per session: the Application id from the file, and SHA-256 of the root commit SHA (no remote URL). Epic 3 only declares the bridge in the MCP configuration. Epic 4 implements binding.
- **Bundle input:** Applications (id → Project) are registry-authoritative, versioned and append-only. Each Application change goes through whole-bundle validation in core and produces a new bundle input, so Epic 4 can resolve the Application. An invalid change writes nothing.
- **Conventions:** ids are opaque UUIDv7 values minted by the registry, never by clients. Timestamps are UTC ISO-8601. Errors use the single `{ code, message, subject }` envelope, with no partial success. Tenant-scoped tables use RLS, and the app DB role does not own them. Logs carry ids and counts only. Roles are enforced in both the registry and the panel. The panel imports `contract` only.

## UX & Interaction Patterns

- **New-application flow surface:** a description field and a Project picker, then the Boilerplate request with a target-tool choice. The Buyer also sets the Guidance endpoint URL and registers existing Applications here. States: cold-load shows structure first; empty means the form waits for a description and a Project; permission-denied shows a denial; a missing Project names the Project field. There is no offline editing and no queued writes.
- **boilerplate-result:** a raised surface that lists each artifact in text (identification file, dependency pins, design-system references, MCP configuration, skills), with no badges, plus the archive download.
- **Denials and refusals:** the surface stays visible and the refusal is announced as a status. Controls are never hidden by role.
- **Forms:** use standard-form styling. An invalid submit keeps the field and adds ink text under it. Opening a form focuses its first field, and Esc leaves without committing. Every control has a text label, and pointer targets are at least 24px. Gold is reserved for the primary action.
- **Glossary:** use the terms exactly: Application, New-application flow, Boilerplate, Project identification file, baseline set, unbound Application, Builder, Buyer.

## Cross-Story Dependencies

- **Within this epic:**
  - Story 3.1 (build grant, Application creation, flow flag) comes first.
  - Story 3.2 (contract file and registry rendering) is needed by Stories 3.3, 3.4 and 3.5.
  - Story 3.3 adds the endpoint URL setting, the core-based resolution and the archive, and Story 3.4 reuses all of them. Story 3.4 must produce the same identification file and pins as Story 3.3.
  - Story 3.5 reuses the creation and identification-file paths without the Boilerplate.
- **From earlier epics:**
  - Epic 2 supplies the Project tree, the Effective Standard set resolver and the Locked rules.
  - Epic 1 supplies accounts and roles, code-stack and design-system Standards, the denial pattern, panel chrome and the Inventory nav entry.
- **Later epics:**
  - Epic 4 packs Applications into signed bundles and implements the bridge, headers, fingerprint binding and `unbound`. Boilerplates from Epic 3 need no regeneration.
  - Epic 5 refuses Gate runs using the identification file.
  - Epic 6 fills in Inventory evidence by Project and agent tool.
  - Epic 7 compares flow-created Applications with the baseline set.
