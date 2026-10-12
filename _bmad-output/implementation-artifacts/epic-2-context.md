# Epic 2 Context: The Buyer shapes a Project tree whose Locked rules cannot be escaped

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Go beyond the single root Project of Epic 1 and give each Company its own Project tree. The Buyer creates Projects, sets zero or one parent, names what each level means, marks Locked rules, and grants accounts permission to create child Projects. Standard owners can then scope Standards to any Project. The pure resolver in `packages/core` returns the Effective Standard set for any Project: within a conflict slot, the closest Project wins, and an ancestor's Locked rule always stays. Every later surface depends on this set (Guidance, the Gate, the Read API). The tree and Locked rules are also the main paid value of the Team plan, so a Community tenant is refused these capabilities in place.

## Stories

- Story 2.1: Buyer builds the Project tree and names its levels
- Story 2.2: Standard owner scopes a Standard to any Project
- Story 2.3: Resolve and preview the Effective Standard set for a Project
- Story 2.4: Buyer marks Locked rules that descendants cannot override
- Story 2.5: Child-Project creation requires a Buyer-granted permission
- Story 2.6: Community plan refuses tree capabilities in place

## Requirements & Constraints

- **Tree shape:** a Project has zero or one parent and any number of children. The level name is free text from the Buyer, stored exactly as typed. Domain Harness never assigns a meaning to a level, and this is an explicit non-goal. A cycle is rejected, and the message names the parent that closes the cycle. A rejected change leaves the tree unchanged.
- **Tenant isolation:** a Company's Projects are invisible to every other Company, both in tree listings and in direct id lookups. RLS is the second guard.
- **Precedence:** the set is resolved from the Project upward. Standards compete only when they share a conflict slot. The Standard scoped closest to the Project wins. Example: the parent allows library X and the child prohibits it, so X is prohibited on the child. Standards in different slots, such as a token and a library, both stay in the set.
- **Locked rules:** only the Buyer marks or unmarks a Locked rule. A Standard owner or Builder who tries gets a denial. A Locked rule from an ancestor stays in the set and is never replaced. Example: a parent Locked rule prohibits X and the child allows X, so X stays prohibited. Validation rejects a descendant Locked rule that contradicts an ancestor's Locked rule in the same slot, and the error names both rules.
- **Child-creation permission:** the Buyer grants or revokes the permission per account and per Project. Without it, the account gets a denial and no Project is created. A child created with the permission still inherits every Locked rule of P and of P's ancestors.
- **Append-only:** Project creates and re-parents, Locked-rule marks and permission grants are all recorded append-only, with who made the change and when.
- **Determinism:** the same inputs give byte-identical output on every run and for every caller. A property test over random trees must prove this. Later, Guidance and the Gate must return the same set for the same Application and bundle.
- **Plan gating:** on Community, the tenant gets one root Project only. Creating a second Project, setting a parent or marking a Locked rule is refused in place. The refusal names "Team (first sale)", shows no price, is announced as a status, and writes nothing. Team succeeds. Plan names exist only in panel text and never in the `contract` result types used by Guidance or the Gate.

## Technical Decisions

- **Core purity:** resolution exists only in `packages/core`, as a pure function of (Project tree, Standards, Locked rules). It does no I/O, reads no clock and makes no network calls. No adapter re-implements it, post-processes its output or caches a derived result across bundles. The panel imports `contract` only, so the preview gets the resolved set from the registry.
- **Conflict slot:** a slot is the tuple (Module kind, slot kind, name), and Epic 1 already implements it in core. Uniqueness applies per (slot, Project scope). The same slot at a child scope is allowed. A second live Standard in one slot at one scope is a core error in the `{ code, message, subject }` envelope that names both Standards, never a guess.
- **Whole-bundle validation:** every registry mutation (publish, re-parent, Locked-rule mark, and later Application changes) validates the whole proposed bundle input through core before it is accepted. An invalid mutation writes nothing, with no partial success.
- **Registry authority:** the vendor registry (`apps/registry`) is the only authority for the tree, Locked rules and permissions. They reach the Company environment only through signed bundles (Epic 4), so keep their shapes bundle-ready in `contract`.
- **Conventions:** Project ids are opaque UUIDv7 values minted by the registry. Timestamps are UTC ISO-8601. Every new tenant-scoped table has RLS, and the app DB role does not own the tables. Logs carry ids and counts only.
- **Roles:** roles are enforced in both the registry and the panel. The tenant's plan attribute (Community, Team, Business or Enterprise) drives plan refusals.

## UX & Interaction Patterns

- **project-node:** an accessible tree. Each node announces its Project name and level name, is indented 16px, and the selected node is at weight 600 (not gold). Marking a Locked rule and granting child-creation permission happen from this surface. A Locked-rule mark is visible on the tree.
- **Project tree surface states:** cold-load shows the structure first. The empty state means no Project beyond the root. A cycle failure shows text naming the closing parent, and the Buyer picks another parent. A missing child permission gets a denial and nothing is created. On Community, the surface shows a plan-refusal. There is no offline editing and no queued writes.
- **Effective set preview:** selecting a Project shows a table with header cells. Each row gives the slot, status, version and source Project. A Locked rule shows as coming from its ancestor.
- **standard-form:** gains a Project-scope picker. The published version shows the chosen scope.
- **Refusals:** a denial and a plan-refusal keep the surface visible and are announced as a status. Never hide a control by role or plan. A plan-refusal never shows a price.
- **Chrome:** add the Project tree entry to the panel nav. Level names in another language are marked with their language. Use the glossary terms exactly: Project, Project tree, Locked rule, Effective Standard set, Conflict slot.
- **Layout:** at ≥1280px, tables sit beside the Project tree context. Keyboard, focus and 24px target rules apply as in Epic 1.

## Cross-Story Dependencies

- **Within this epic:**
  - Story 2.1 (tree, re-parent, cycle check) comes first. Stories 2.2 to 2.5 need multiple Projects.
  - Story 2.2 extends Epic 1 publishing (Stories 1.5 and 1.6) from the root scope to any Project scope.
  - Story 2.3 builds the core resolver and the preview. Stories 2.4 and 2.5 extend and assert against it, with Locked rules in the set and children inheriting them.
  - Story 2.6 gates the actions from Stories 2.1 and 2.4.
- **From Epic 1:** this epic reuses the tenant/RLS layer, accounts and roles, the plan attribute, Modules and owners, the core slot rule, the error envelope, and the denial pattern.
- **Later epics:**
  - Epic 3 places Applications on Projects and resolves the Boilerplate through this resolver.
  - Epic 4 packs the tree, Locked rules and Standards into signed bundles, and Guidance and the Read API serve this same set.
  - Epic 5 evaluates the Gate against it.
  - Epic 3 adds a per-Project build grant, which is separate from the child-creation permission in this epic.
